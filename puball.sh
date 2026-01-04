#!/bin/bash

set -e

# 并行处理函数
publish_package() {
    dir="$1"
    if [ ! -f "$dir/package.json" ]; then
        echo "跳过 $dir, 没有 package.json"
        return
    fi

    name=$(jq -r '.name' "$dir/package.json")
    version=$(jq -r '.version' "$dir/package.json")

    # 获取 npm 上的最新版本
    latest=$(npm view "$name" version 2>/dev/null || echo "none")

    if [ "$version" != "$latest" ]; then
        if [[ "$dir" == plugins/* || "$dir" == common/* ]]; then
            echo "构建插件 $name (yarn build $name)..."
            yarn build "$name" || { echo "构建失败，跳过 $name"; return; }
        elif jq -e '.scripts.build' "$dir/package.json" > /dev/null; then
            echo "构建 $name..."
            (cd "$dir" && yarn build) || { echo "构建失败，跳过 $name"; return; }
        fi
        echo "发布 $name@$version (当前 npm 最新: $latest)"
        (cd "$dir" && npm publish --tag latest --access public --registry https://registry.npmjs.org/) || echo "发布失败，跳过 $name"
    else
        echo "$name@$version 已经是最新版本，跳过"
    fi
}

# 遍历目录并后台执行
for dir in package/*/ plugins/*/ renderer/*/ common/*/; do
    publish_package "$dir" &
done

# 等待所有后台任务完成
wait
echo "全部处理完成！"
