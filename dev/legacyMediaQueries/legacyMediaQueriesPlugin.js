// dev/legacyMediaQueries/legacyMediaQueriesPlugin.js
//
// Tailwind v4 的断点全部写成媒体查询区间语法（`@media (width >= 48rem)`）。
// 这种语法 Chromium 104 才支持；装在旧 Android System WebView 上的手机（诊断里
// 用户 agent 是 Chrome/99）会把整条 `md:` 规则当非法语句直接丢弃。
//
// 后果不是「布局略小一档」，而是同一处布局的两半裂开：JS 的 matchMedia('(min-width: 768px)')
// 是经典语法，照样匹配 → 设置弹窗渲染出左侧栏；CSS 的 md:grid / md:grid-cols 却全被丢掉 →
// 面板退回 flex 单列，aside 的 w-full 占满整块面板，右侧内容列高度归零。横屏设置弹窗
// 因此整页空白（0.7.29-android.473 用户截图）。
//
// 这里在打包时把区间语法改写成经典语法（语义等价），旧 WebView 也能解析。

/** 媒体特性里出现的长度值：`48rem`、`768px`、`400px`、`0`。 */
const VALUE = '(?:[-+]?(?:\\d*\\.\\d+|\\d+)(?:px|rem|em|vw|vh|dvh|dvw|ch|ex|pt|cm|mm|in)?)';

/** 每个括号条件单独看：`(width >= 48rem)`、`(640px <= width < 1024px)`。 */
const CONDITION = /\(\s*([^()]+?)\s*\)/g;

const DUAL_RANGE = new RegExp(`^(${VALUE})\\s*(<=|<)\\s*(width|height)\\s*(<=|<)\\s*(${VALUE})$`);
const FEATURE_FIRST = new RegExp(`^(width|height)\\s*(>=|>|<=|<)\\s*(${VALUE})$`);
const FEATURE_LAST = new RegExp(`^(${VALUE})\\s*(>=|>|<=|<)\\s*(width|height)$`);

// 严格比较（`>` / `<`）在经典语法里没有对应写法，用 0.02px 的差量表达：
// `(width > 48rem)` 等价于 `(min-width: calc(48rem + 0.02px))`。
// 媒体查询里用 calc() 是 Chromium 66 起就有的能力，比区间语法（104）低得多。
const justAbove = (value) => `calc(${value} + 0.02px)`;
const justBelow = (value) => `calc(${value} - 0.02px)`;

/** `width >= X` 这一侧 → 下界；反过来的 `X <= width` 也是下界。 */
const lowerBound = (feature, operator, value) => (operator === '>=' || operator === '<='
    ? `(min-${feature}: ${value})`
    : `(min-${feature}: ${justAbove(value)})`);

/** `width <= X` 这一侧 → 上界；反过来的 `X >= width` 也是上界。 */
const upperBound = (feature, operator, value) => (operator === '<=' || operator === '>='
    ? `(max-${feature}: ${value})`
    : `(max-${feature}: ${justBelow(value)})`);

/** 一个括号条件 → 经典写法；不是区间比较就返回 null（原样保留）。 */
const rewriteCondition = (condition) => {
    const dual = condition.match(DUAL_RANGE);
    if (dual) {
        const [, lowValue, lowOperator, feature, highOperator, highValue] = dual;
        // `A < width < B`：下界用 A，上界用 B，两个比较各自决定要不要差 0.02px。
        return `${lowerBound(feature, lowOperator, lowValue)} and ${upperBound(feature, highOperator, highValue)}`;
    }
    const featureFirst = condition.match(FEATURE_FIRST);
    if (featureFirst) {
        const [, feature, operator, value] = featureFirst;
        return operator.startsWith('>')
            ? lowerBound(feature, operator, value)
            : upperBound(feature, operator, value);
    }
    const featureLast = condition.match(FEATURE_LAST);
    if (featureLast) {
        const [, value, operator, feature] = featureLast;
        return operator.startsWith('<')
            ? lowerBound(feature, operator, value)
            : upperBound(feature, operator, value);
    }
    return null;
};

/**
 * 把一段媒体查询参数里的区间语法全部改写成经典语法。
 *
 * `(width >= 48rem)` → `(min-width: 48rem)`
 * `(width < 48rem)`  → `(max-width: calc(48rem - 0.02px))`
 * `(640px <= width < 1024px)` → `(min-width: 640px) and (max-width: calc(1024px - 0.02px))`
 *
 * 认不出来的条件原样保留，交给 Vite 插件在产物里做最后一道检查。
 */
export const rewriteRangeSyntax = (params) => params.replace(CONDITION, (match, condition) => {
    const rewritten = rewriteCondition(condition.trim());
    return rewritten ?? match;
});

/** 参数里还残留比较符号，说明有没改写到的形状。 */
export const hasRangeSyntax = (params) => /[<>]/.test(params);

/** @type {import('postcss').PluginCreator<void>} */
const legacyMediaQueries = () => ({
    postcssPlugin: 'folia-legacy-media-queries',
    // 必须用 OnceExit：Tailwind 的插件在它自己的 Once 里才把工具类展开成 @media，
    // 用 Once 会在那些 at-rule 出现之前就跑完，什么都改不到。
    OnceExit(root) {
        root.walkAtRules(/^(media|container)$/i, atRule => {
            const rewritten = rewriteRangeSyntax(atRule.params);
            if (rewritten !== atRule.params) atRule.params = rewritten;
        });
    },
});

legacyMediaQueries.postcss = true;

export default legacyMediaQueries;
