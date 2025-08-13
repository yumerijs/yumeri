#!/bin/bash

set -e

for dir in package/*/ plugins/*/; do
    if [ ! -f "$dir/package.json" ]; then
        echo "跳过 $dir, 没有 package.json"
        continue
    fi

    cd "$dir"
    name=$(jq -r '.name' package.json)
    version=$(jq -r '.version' package.json)
    
    # 获取 npm 上的最新版本
    latest=$(npm view "$name" version 2>/dev/null || echo "none")

    if [ "$version" != "$latest" ]; then
        echo "发布 $name@$version (当前 npm 最新: $latest)"
        npm publish --tag latest --access public --registry https://registry.npmjs.org/
    else
        echo "$name@$version 已经是最新版本，跳过"
    fi

    cd - > /dev/null
done

