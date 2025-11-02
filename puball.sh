#!/bin/bash

set -e

# 并行处理函数
publish_package() {
    dir="$1"
    if [ ! -f "$dir/package.json" ]; then
        echo "跳过 $dir, 没有 package.json"
        return
    fi

    cd "$dir" || return
    name=$(jq -r '.name' package.json)
    version=$(jq -r '.version' package.json)

    # 获取 npm 上的最新版本
    latest=$(npm view "$name" version 2>/dev/null || echo "none")

    if [ "$version" != "$latest" ]; then
        echo "发布 $name@$version (当前 npm 最新: $latest)"
        rm tsconfig.tsbuildinfo
        npm publish --tag latest --access public --registry https://registry.npmjs.org/
    else
        echo "$name@$version 已经是最新版本，跳过"
    fi

    cd - > /dev/null
}

# 遍历目录并后台执行
for dir in package/*/ plugins/*/; do
    publish_package "$dir" &
done

# 等待所有后台任务完成
wait
echo "全部处理完成！"