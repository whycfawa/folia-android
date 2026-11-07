import { describe, expect, it } from 'vitest';
import { flattenLocale } from '../../../src/i18n/flattenLocale';

// test/unit/i18n/flattenLocale.test.ts

describe('flattenLocale', () => {
  it('flattens nested locale entries into dotted keys', () => {
    expect(flattenLocale({
      tv: {
        home: {
          title: '首页',
          count: 3,
          enabled: false,
        },
      },
    })).toEqual({
      'tv.home.title': '首页',
      'tv.home.count': '3',
      'tv.home.enabled': 'false',
    });
  });

  it('keeps leaf keys when a prefix is supplied', () => {
    expect(flattenLocale({ title: '标题' }, 'player')).toEqual({
      'player.title': '标题',
    });
  });
});
