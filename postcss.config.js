import tailwind from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';
import legacyMediaQueries from './dev/legacyMediaQueries/legacyMediaQueriesPlugin.js';

export default {
  plugins: [
    tailwind(),
    // 把 Tailwind v4 的区间语法媒体查询改写成经典语法：旧 Android System WebView 不认区间语法，
    // 会把整个断点档静默丢掉（见插件文件头的说明）。
    legacyMediaQueries(),
    autoprefixer(),
  ],
};
