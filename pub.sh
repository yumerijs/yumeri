#!/bin/bash

set -e

for dir in package/*/ plugins/*/ renderer/*/ common/*/; do
    if [ ! -f "$dir/package.json" ]; then
        echo "跳过 $dir, 没有 package.json"
        continue
    fi

    name=$(jq -r '.name' "$dir/package.json")
    version=$(jq -r '.version' "$dir/package.json")
    
    # 获取 npm 上的最新版本
    latest=$(npm view "$name" version 2>/dev/null || echo "none")

    if [ "$version" != "$latest" ]; then
        build_ok=1
        if [[ "$dir" == plugins/* || "$dir" == common/* ]]; then
            echo "构建插件 $name (yarn build $name)..."
            yarn build "$name" || build_ok=0
        elif jq -e '.scripts.build' "$dir/package.json" > /dev/null; then
            echo "构建 $name..."
            (cd "$dir" && yarn build) || build_ok=0
        fi
        if [ "$build_ok" -eq 0 ]; then
            echo "构建失败，跳过发布 $name"
            continue
        fi
        echo "发布 $name@$version (当前 npm 最新: $latest)"
        (cd "$dir" && npm publish --tag latest --access public --registry https://registry.npmjs.org/) || echo "发布失败，跳过 $name"
    else
        echo "$name@$version 已经是最新版本，跳过"
    fi

done
