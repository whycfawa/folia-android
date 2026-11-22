// dev/legacyMediaQueries/legacyMediaQueriesAssetsPlugin.js
//
// postcss 插件改写过一次还不够：Vite 的 css 压缩器（Lightning CSS）会按现代浏览器目标
// 把 `min-width: 48rem` 又「优化」回 `(width >= 48rem)`，旧 Android System WebView 照样整档丢弃。
// 所以在产物层面再改一次：generateBundle 里直接改 CSS 资产的内容，压缩之后、写盘之前。

import postcss from 'postcss';
import { hasRangeSyntax, rewriteRangeSyntax } from './legacyMediaQueriesPlugin.js';

/** @returns {import('vite').Plugin} */
export const legacyMediaQueriesAssetsPlugin = () => ({
    name: 'folia-legacy-media-queries-assets',
    enforce: 'post',
    generateBundle(_options, bundle) {
        for (const file of Object.values(bundle)) {
            if (file.type !== 'asset' || !String(file.fileName).endsWith('.css')) continue;
            if (typeof file.source !== 'string') {
                // 静默跳过会让人以为改写过：真出现非字符串的 css 资产就当场说出来。
                this.error(`${file.fileName}：css 资产不是字符串，区间语法改写被跳过`);
                continue;
            }
            // 走 AST 而不是正则：压缩产物里可能有 content:"@media (width >= 1px)" 这样的字符串，
            // 正则会把里面的文字一起改坏，而 walkAtRules 只碰真的 at-rule。
            const root = postcss.parse(file.source);
            let rewritten = 0;
            root.walkAtRules(/^(media|container)$/i, atRule => {
                const next = rewriteRangeSyntax(atRule.params);
                if (next === atRule.params) return;
                atRule.params = next;
                rewritten += 1;
            });
            if (rewritten === 0) continue;
            const source = root.toString();
            // 最后一道检查：产物里不许再有没改写到的比较符号，否则旧 WebView 会把整档丢掉。
            const leftover = [];
            postcss.parse(source).walkAtRules(/^(media|container)$/i, atRule => {
                if (hasRangeSyntax(atRule.params)) leftover.push(`@${atRule.name} ${atRule.params}`);
            });
            if (leftover.length > 0) {
                this.error(`${file.fileName}：还有没改写到的区间语法媒体查询\n  ${leftover.join('\n  ')}`);
                continue;
            }
            file.source = source;
        }
    },
});
