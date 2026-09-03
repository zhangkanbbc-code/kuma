import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import lodeValidation from '../dist/main/lode-validation.js'
import lodeIds from '../dist/shared/lode-ids.js'
import { FIRST_PARTY_LODE_IDS } from '../scripts/lib/bundled-lodes.mjs'
import { isPackageIgnored } from '../scripts/lib/package-ignore.mjs'

const { SUPPORTED_LODE_IDS, validateLodePack } = lodeValidation
const { CONSUMED_LODE_IDS } = lodeIds
const lodeSources = JSON.parse(
  fs.readFileSync(new URL('../scripts/lode-sources.json', import.meta.url), 'utf8'),
)

const pack = (id, data) => ({
  meta: {
    id,
    name: id,
    version: '1',
    source: 'test',
    fetchedAt: '2026-08-05T00:00:00.000Z',
  },
  data,
})

const validData = {
  'abyssal-stats': {
    1501: { api_id: 1501, api_taik: 20, api_maxeq: [0], kc3_slots: [1501], kc3_oasw: false },
  },
  // [升下一级所需, 达到该级的累计]；累计必须单调不减。
  // 样本必须带上**高等级那一段的真实量级**：这张表到 Lv188 累计两千万出头，
  // 早先只拿三位数当样本，校验里那个「一百万」的默认上限就没人发现——
  // 真包被整个判非法丢掉，界面只是安静地不显示经验换算。
  'ship-exp': {
    1: [100, 0],
    2: [200, 100],
    3: [300, 300],
    100: [10000, 1000000],
    101: [1000, 1010000],
    187: [1600000, 18600000],
    188: [0, 20200000],
  },
  'dev-recipes': {
    equipment: { '12.7cm連装砲': [{ secretary: '水雷系', table: '钢/燃', rate: 10 }] },
    tablesScanned: 21,
  },
  'build-recipes': {
    recipes: Array.from({ length: 12 }, (_, i) => ({
      target: '駆逐艦',
      recipe: [30 + i, 30, 30, 30],
      note: '最低値レシピ',
    })),
    times: Array.from({ length: 20 }, (_, i) => ({
      time: `00:${String(18 + i).padStart(2, '0')}:00`,
      stype: '駆逐艦',
      ships: ['睦月', '如月'],
      largeOnly: [],
    })),
    tablesScanned: 9,
  },
  'akashi-list': {
    items: { 1: { id: 1, item_name: { ja: '装备', zh: '装备' }, item_remodel: { 火力: ['+1'] } } },
    pre_star: [],
    week: ['日'],
  },
  'kcwiki-ships': {
    '001a': { ID: 275, 日文名: '長門改', 中文名: '长门改', 舰种: 9, 数据: {}, 消耗: {}, 改造: null },
  },
  'kcwiki-expedition': {
    E1: {
      id: 'E1',
      nameJp: '遠征',
      nameZh: '远征',
      time: '7:30',
      flagLv: 1,
      minShips: 6,
      tags: [],
      rewards: null,
    },
  },
  'kcwiki-bgm': { schemaVersion: 1, battle: { 118: '梅雨明けの白露', 275: '戦隊を統べる月の花' } },
  'wikiwiki-expedition': {
    E1: {
      id: 'E1',
      nameJp: '遠征',
      difficulty: 'S',
      descriptionJp: '説明',
      time: '7:30',
      useFuelText: '80%',
      useBullText: '70%',
      tags: ['月常'],
      monthly: true,
      combat: null,
      flagLv: 1,
      fleetLv: 100,
      minShips: 6,
      composition: '驱逐*6',
      rawComposition: '駆逐6隻',
      stats: { 火力: 100 },
      drumTotal: null,
      drumShips: null,
      greatNote: null,
      rewards: {
        hqExp: 10,
        shipExp: 20,
        fuel: [100, 13],
        ammo: null,
        steel: null,
        baux: null,
        items: [{ name: '高速修復材', count: 1, min: 0 }],
        greatItems: [],
      },
    },
  },
  'quests-scn': {
    101: { code: 'A1', name: '', desc: '说明', memo: '', memo2: '', pre: [] },
  },
  'eo-quests': [
    { api_id: 101, code: 'A1', name_jp: '任務', desc_jp: '説明', name_en: null, desc_en: null },
  ],
  'wikiwiki-item-exchange': {
    68: {
      name: '秋刀魚',
      yearly: [
        { year: '2015', offer: '刺身', cost: '3尾', gets: '弾薬x300 + 鋼材x150', note: '' },
        { year: '2025', offer: '秋刀魚カレー改三甲', cost: '41尾', gets: '四式重爆 飛龍＋イ号一型甲 誘導弾★+4', note: '「最大1回」調理可能' },
      ],
    },
    62: {
      name: '菱餅',
      fixed: [{ offer: '甘味', gets: '伊良湖×1' }],
    },
    90: {
      name: '節分の豆',
      history: [{ year: '2026', detail: '「恵方震電」節分の豆x34→(試製 震電★2,1回のみ)' }],
    },
    1: {
      name: '高速修復材',
      overview: '入渠時間を短縮できる。保有上限3,000',
    },
    70: {
      name: '熟練搭乗員',
      overview: '精鋭の航空部隊を新規編成するために必要な航空機搭乗員。',
      usage: ['任務 (単発)', '(F51) 精鋭「水戦」隊の新編成'],
    },
  },
  'wikiwiki-quests': {
    A2: {
      code: 'A2',
      nameJp: '「駆逐隊」を編成せよ！',
      pre: ['A1'],
      condRaw: '(A1)はじめての「編成」！ 達成後',
      page: '任務/編成任務',
    },
    B204: {
      code: 'B204',
      nameJp: '発展「третий」、行動開始！',
      pre: ['B135', 'C15'],
      condRaw: '(B135)… 及び (C15)… 達成後？',
      page: '任務/出撃任務',
      uncertain: true,
    },
    C2: {
      code: 'C2',
      nameJp: '旧演習任務',
      pre: [],
      condRaw: '',
      page: '任務/演習任務',
      aligned: false,
    },
    A90: {
      code: 'A90',
      nameJp: '拡張「六水戦」',
      pre: [],
      mentioned: ['A86'],
      condRaw: '(A86)と同時に受領可能',
      page: '任務/編成任務',
    },
  },
  'kcwiki-quest-req': {
    410: { category: 'expedition', objects: [{ times: 1, id: [37, 38] }] },
  },
  'poi-quest-goal': {
    218: {
      type: 1,
      sinking: {
        description: '敌补给舰',
        shipType: [15],
        required: 3,
        init: 0,
      },
    },
  },
  'poi-fcd-map': {
    '1-1': { spots: { A: [10, 20, 'start'] }, route: { 1: [null, 'A'] } },
  },
  'equip-upgrades': [
    { eq_id: 1, improvement: [{}], convert_to: [], upgrade_for: [2] },
  ],
  // 对空射击回避事实表（第一方随包）：两个补正是乘数，档位只认原文那五个符号。
  'equip-aa-evasion': [
    { eq_id: 170, weighted_aa: 0.6, fleet_aa: 1, tier: '△', basis: '整理参照 · 单源待印证 2026-08-17' },
    { eq_id: 479, weighted_aa: 0.6, fleet_aa: 0.7, tier: '◯', basis: '整理参照 · 单源待印证 2026-08-17' },
    { eq_id: 561, weighted_aa: 0.4, fleet_aa: 0.4, tier: '❀', basis: '整理参照 · 单源待印证 2026-08-17' },
  ],
  // 改修事实表（第一方随包）：每行必须带 basis（这一格的置信等级）。
  // `ship_ids: [-1]` 是「这一档不要二号舰」的哨兵，是真语义，得放行。
  'equip-improve': [
    {
      eq_id: 1,
      improvement: [
        {
          convert: { id_after: 2, lvl_after: 0 },
          helpers: [{ ship_ids: [3, 4], days: [0, 6] }],
          costs: { fuel: 10, ammo: 10, steel: 0, baux: 0, p1: { devmats: 1 } },
          basis: '整理参照·交叉核对',
        },
        {
          convert: null,
          helpers: [{ ship_ids: [-1], days: [0, 1, 2, 3, 4, 5, 6] }],
          costs: { fuel: 10, ammo: 10, steel: 0, baux: 0 },
          basis: '游戏内实测 2026-08-25',
        },
      ],
      pending: ['某一格待核：两份公开资料不一致，等游戏内实测'],
    },
  ],
  'kcwiki-voice': {
    1: [{ key: '', scene: '战绩', ja: '原文', zh: '译文' }],
  },
  // 台词自补层：第一方译文 + 日文原文列（2026-08-22 起两列都收）
  'kanso-voice': {
    schemaVersion: 1,
    compiledAt: '2026-08-22',
    ships: {
      973: [
        { key: '973-1', scene: '入手/登入时', slot: 1, basis: 'wikiwiki-mapped', ja: '原文', zh: '译文' },
        // 同槽多候选：至多只有一句对得上音轨，故不给键——但它是合法数据
        { key: '973-20.1', scene: '小破2', slot: 20, basis: 'ambiguous', ja: '原文', zh: '译文', draft: true },
      ],
    },
  },
  'kcwiki-seasonal-voice': {
    schemaVersion: 1,
    seasons: {
      '2026-情人节': {
        title: '2026年情人节',
        year: 2026,
        name: '情人节',
        page: '季节性/2026年情人节',
        updatedAt: '2026-02-16T00:00:00Z',
      },
    },
    ships: {
      973: [
        { season: '2026-情人节', key: '573-Sec1Valentine2026', scene: '秘书舰1', slot: 2, ja: '原文', zh: '译文' },
        // 任一侧缺失都如实留空——这是合法状态，不是坏数据
        { season: '2026-情人节', key: '573-Sec2Valentine2026', ja: '原文', zh: '' },
        { season: '2026-情人节', key: '573-Sec3Valentine2026', ja: '', zh: '只有中文' },
      ],
    },
  },
  'wikiwiki-voice': {
    955: [{ key: '清霜改二#0-1', voiceId: 1, scene: '入手/登录', ja: '原文', page: '清霜改二' }],
  },
  'wikiwiki-ship-profile': {
    992: {
      shipId: 992,
      nameJp: '杉',
      cv: '倉西希奈',
      artist: '海原さかな',
      shipClass: ['松型', 7],
      initialEquips: [229, -1],
    },
  },
  'ship-stats': {
    schemaVersion: 1,
    compiledAt: '2026-08-22T00:00:00.000Z',
    voters: { kcwiki: '基座', wikiwiki: '投票', ledger: '一手' },
    forms: {
      916: {
        name: '大和改二重',
        // 值与印证档必须成对：账本一手裁的 max、只有基座一票的 init
        evasion: { init: 25, initState: 'single', max: 62, maxState: 'ledger' },
        asw: { init: 16, initState: 'multi', max: 48, maxState: 'multi' },
        // 三张票都没有的格：值与档一起缺，不摆 0
        los: { init: null, initState: null, max: null, maxState: null },
      },
    },
  },
  'wikiwiki-ship-max': {
    593: {
      shipId: 593,
      nameJp: '榛名改二乙',
      no: '393',
      kaihi: 75,
      taisen: 0,
      sakuteki: 53,
    },
    1065: {
      shipId: 1065,
      nameJp: '日枝丸',
      no: '655',
      kaihi: 26,
      taisen: 10,
      sakuteki: 30,
      kaihiInit: 14,
      taisenInit: 1,
      sakutekiInit: 10,
      source: 'ship-page',
    },
  },
  'wikiwiki-remodel': {
    1040: {
      targetShipId: 1040,
      fromShipId: 226,
      level: 95,
      page: '吹雪',
      raw: 'Lv95+海外艦最新技術x5',
      pageUpdatedAt: '2026-08-05T00:00:00+09:00',
      needs: [
        { kind: 'useitem', id: 100, nameJp: '海外艦最新技術', count: 5 },
        { kind: 'slotitem', id: 87, nameJp: '新型高温高圧缶', count: 2 },
      ],
      // 分边格式：回环边（チャート再次出现）与脚注回程边各带自己的来路
      edges: [
        {
          fromShipId: 1041,
          level: 90,
          raw: 'Lv90+高速建造材x30',
          source: 'chart',
          needs: [{ kind: 'useitem', id: 2, nameJp: '高速建造材', count: 30 }],
        },
        {
          fromShipId: 1042,
          raw: '戻す場合、高速建造材x40と開発資材x15',
          source: 'footnote',
          needs: [
            { kind: 'useitem', id: 2, nameJp: '高速建造材', count: 40 },
            { kind: 'useitem', id: 3, nameJp: '開発資材', count: 15 },
          ],
        },
      ],
    },
  },
  'wikiwiki-abyss-voice': {
    2297: [{
      key: '駆逐ラ級ζ-壊#abyss-0-2',
      scene: '開幕前',
      ja: '原文',
      page: '駆逐ラ級ζ-壊',
      slot: 'opening',
      suffix: 10,
    }],
  },
  'subtitle-zh': {
    version: '2023100218',
    1: { 1: '台词' },
  },
  'subtitle-ja': {
    version: '2023100218',
    1: { 1: '台詞' },
  },
  'subtitle-npc': {
    301: { name: '明石', jp: '工廠へようこそ！', zh: '欢迎来到明石的工厂！' },
    1186: [{ name: '满潮', jp: '待たせたわね！', zh: '久等了！', time: 10 }],
  },
  'subtitle-enemies': {
    383172210: { name: '護衛棲姫', jp: 'ネムッテ…イタノニ……。', zh: '正睡得……好好的……。' },
  },
  'fit-bonus': [
    { ids: [1], bonuses: [{ shipClass: [1], bonus: { houg: 1 } }] },
  ],
  'kcwiki-routing': {
    '1-1': {
      nodes: [{ from: 'A', rules: ['满足条件去B'] }],
      credit: '',
      page: '镇守府海域/1-1/带路条件',
      contentDate: '2021-10-06',
    },
  },
  'wikiwiki-routing': {
    schemaVersion: 1,
    maps: {
      '1-1': {
        page: '鎮守府海域/1-1',
        sourceUrl: 'https://wikiwiki.jp/kancolle/鎮守府海域/1-1',
        checkedAt: '2026-08-06',
        nodes: [{
          from: 'A',
          routes: [
            { to: 'B', conditionJp: 'ランダム' },
            { to: 'C', conditionJp: 'ランダム' },
          ],
        }],
      },
    },
  },
  'kcnav-routing': {
    schemaVersion: 1,
    window: { start: '2026-05-08', end: '2026-08-07' },
    minCount: 5,
    maps: {
      '1-1': {
        retrieved: '2026-08-06T17:37:38+09:00',
        branches: {
          A: {
            edges: [
              {
                edgeId: 2,
                to: 'B',
                comps: [{ fleetTypes: [0], fleet1Comp: ['DD'], fleet2Comp: [], count: 20 }],
              },
              {
                edgeId: 3,
                to: 'C',
                comps: [{ fleetTypes: [0], fleet1Comp: ['DD'], fleet2Comp: [], count: 80 }],
              },
            ],
          },
        },
      },
    },
  },
  'map-intel': {
    schemaVersion: 1,
    maps: {
      '1-1': {
        source: 'test',
        sourceUrl: 'https://example.test',
        checkedAt: '2026-08-05',
        revision: '1',
        nodes: { A: { emptyDrop: 'unknown', ships: [], enemyComps: [] } },
      },
    },
  },
  'map-enemy-comps': {
    schemaVersion: 1,
    compiledAt: '2026-08-22',
    voters: { kcwiki: '舰娘百科「深海配置」' },
    maps: {
      '1-1': {
        source: 'kuma 汇编',
        sourceUrl: 'https://example.test',
        checkedAt: '2026-08-22',
        revision: '2026.08.22',
        contentDate: '2026-03-19',
        nodes: {
          A: [
            {
              formation: 1,
              ships: [1501],
              labels: ['駆逐イ級'],
              exp: 10,
              votes: ['kcwiki', 'wikiwiki'],
            },
          ],
        },
      },
    },
  },
  'map-drops': {
    schemaVersion: 1,
    compiledAt: '2026-08-22',
    voters: { kcwiki: '舰娘百科「舰娘掉落表」' },
    sourceNotes: ['主要数据来源为 日wiki 补充数据来自 英文wikia 如果有冲突 默认以日wiki为准'],
    maps: {
      '1-1': {
        source: 'kuma 汇编',
        sourceUrl: 'https://example.test',
        checkedAt: '2026-08-22',
        revision: '2026.08.22',
        contentDate: '2026-03-19',
        nodes: {
          C: {
            emptyDrop: 'confirmed',
            emptyDropVotes: ['wikiwiki'],
            ships: [{ id: 1, votes: ['kcwiki', 'wikiwiki', 'ledger'] }, { id: 2, votes: ['kcwiki'] }],
          },
        },
      },
    },
  },
  'map-drop-windows': {
    schemaVersion: 1,
    compiledAt: '2026-08-22',
    checkedAt: '2026-06-26',
    source: 'kuma 限定期台账（第一方维护）',
    revision: '2026.08.22',
    voters: { ledger: '本机遭遇志' },
    maps: {
      '1-1': {
        C: [
          {
            id: 457,
            limitedOnly: true,
            window: {
              from: '2025-10-29',
              until: null,
              lastConfirmedAt: '2026-06-26',
              status: 'active_confirmed',
              statusChangedAt: '2026-06-26',
              label: '山風、磯風など',
            },
            evidence: { kind: 'community', note: '社区资料整理，只作参考', recordedAt: '2026-08-22' },
            votes: ['wikiwiki'],
            conflict: 'limited-vs-plain',
          },
          {
            id: 699,
            window: {
              from: '2020-09-17',
              until: '2026-01-31',
              lastConfirmedAt: '2026-06-26',
              status: 'ended_confirmed',
              statusChangedAt: '2026-06-26',
            },
            history: [
              { from: '2019-09-17', until: null, lastConfirmedAt: '2020-01-01', status: 'end_pending' },
            ],
            evidence: { kind: 'ledger', note: '本机遭遇志实测捞到过', recordedAt: '2026-08-22' },
            votes: ['wikiwiki', 'ledger'],
          },
        ],
      },
    },
  },
  'event-lifecycle': {
    schemaVersion: 1,
    events: [
      {
        mapAreaId: 62,
        name: '反撃！第三十一戦隊の戦い',
        nameZh: '反击！第三十一战队之战',
        from: '2026-07-08',
        until: '2026-09-10',
        status: 'active',
        phases: [
          { openedAt: '2026-07-08T21:59:00+09:00', maps: [1, 2, 3] },
          { openedAt: '2026-07-19T02:03:00+09:00', maps: [4, 5] },
        ],
        mapNamesZh: { 1: '九州近海' },
        operationNamesZh: { 1: '第三十一战队驱逐舰的出击' },
      },
    ],
  },
  'event-bonus': {
    events: {
      E4: {
        title: 'E4 倍卡表（2026.08.07）',
        entries: [
          { scope: '全图', by: 'stype', key: '驱逐', value: 1.04, certain: true },
          { scope: 'P4 Boss（X点）', by: 'equipGroup', key: 'B组', value: 1.08, certain: true },
          { scope: '全图', by: 'ship', key: 'Jean Bart', value: 1.7695, certain: false },
        ],
        equipGroups: { 'B组': ['九七式中戦車(チハ)'] },
      },
    },
    conflicts: [{ event: 'E4', by: 'ship', key: 'Mogador', prefer: 'kcwiki' }],
    unmodeled: [{ event: 'E4', key: 'Visby', reason: '随机补正' }],
  },
  'kcwiki-fit-bonus': {
    schemaVersion: 1,
    equipGroups: { 'radar-surface': { zh: '对水面电探', tokens: ['对水面雷达/电探'] } },
    equips: {
      122: {
        id: 122,
        nameJa: '10cm連装高角砲+高射装置',
        nameZh: '10cm连装高角炮+94式高射装置',
        rules: [
          { row: 1, who: { classes: [54] }, gain: { kind: 'flat', flat: { fire: 1, aa: 2 } }, stack: 'perEquip' },
          {
            row: 3,
            who: { forms: [656] },
            not: { forms: [648] },
            need: { star: 4, with: [{ group: 'radar-surface' }, { any: [307, 315] }] },
            gain: { kind: 'byStar', steps: [{ from: 4, to: null, stats: { fire: 4, evasion: 3 } }] },
            stack: 'once',
          },
          {
            row: 4,
            who: { all: true },
            gain: { kind: 'byCount', counts: [{ count: 1, stats: { evasion: -2 } }] },
            stack: 'table',
            cap: 2,
            setTotal: { fire: 3, torpedo: 7 },
          },
          {
            row: 5,
            who: { types: [3] },
            gain: { kind: 'byArea', areas: [{ area: 'north', stats: { armor: 3 } }] },
            stack: 'perEquip',
          },
        ],
      },
    },
    unresolved: [],
  },
  'kcwiki-localization': {
    schemaVersion: 1,
    entities: { ship: { 1: { ja: '長門', zh: '长门', source: 'test' } } },
  },
  'event-plane-groups': {
    event: '2026年夏季活动',
    groups: { C2: [479, 433], C3: [459] },
    names: { 479: 'Mosquito FB Mk.VI', 433: 'SM.79 bis(熟練)', 459: 'B-25' },
    basis: '同源转录 · 两家一致但同根 2026-07-28',
  },
}

const invalidData = {
  'event-lifecycle': {
    schemaVersion: 1,
    events: [
      {
        mapAreaId: 62.5,
        name: 'test event',
        from: '2026-07-08',
        until: null,
        status: 'active',
        phases: [{ openedAt: '2026-07-08T21:59:00+09:00', maps: [1] }],
      },
    ],
  },
  // 同一件装备落进两个 C 组：上游不会这么分，出现了就是解析错位
  //（kcwiki 那张表的 `|}` 表尾漏算就会正好造成这种错位），整包拦下而不是带病加载
  'event-plane-groups': {
    event: '2026年夏季活动',
    groups: { C2: [479], C3: [479] },
    basis: '同源转录',
  },
  'event-bonus': {
    events: {
      E4: {
        entries: [{ scope: '全图', by: 'stype', key: '驱逐', value: 0.5, certain: true }],
      },
    },
  },
  'abyssal-stats': {
    1501: { api_id: '1501' },
  },
  // 累计经验倒退（100 → 50）：会让「还差多少经验」算出负数
  'ship-exp': { 1: [100, 100], 2: [200, 50] },
  // rate 是百分比：>100 说明列错位了（把别的列当成出货率读了）
  'dev-recipes': { equipment: { x: [{ secretary: '水雷系', table: '钢/燃', rate: 400 }] } },
  // 通常建造每项投入 30 起；0 说明把表头或备注列当成数字读了
  'build-recipes': {
    recipes: Array.from({ length: 12 }, () => ({ target: '駆逐艦', recipe: [0, 30, 30, 30], note: '' })),
    times: Array.from({ length: 20 }, () => ({ time: '00:18:00', stype: '駆逐艦', ships: [], largeOnly: [] })),
  },
  'akashi-list': {
    items: [],
    pre_star: [],
    week: [],
  },
  'kcwiki-ships': {
    1: { ID: '1', 日文名: '長門', 中文名: '长门' },
  },
  'kcwiki-expedition': {
    E1: { id: 'E1', nameJp: '遠征', nameZh: '远征', time: '七小时', flagLv: 1, minShips: 6 },
  },
  // 站方上传名的序号被当成资源号写进来时的样子：号越出资源路径的三位数范围
  'kcwiki-bgm': { schemaVersion: 1, battle: { 1181: '梅雨明けの白露' } },
  'wikiwiki-expedition': {
    E1: {
      id: 'E1',
      nameJp: '',
      difficulty: 'S',
      descriptionJp: '说明',
      time: '七小时',
      flagLv: 1,
      fleetLv: 100,
      minShips: 6,
      composition: null,
      rawComposition: '',
      stats: null,
      drumTotal: null,
      drumShips: null,
      greatNote: null,
      rewards: {},
    },
  },
  'quests-scn': {
    101: { code: 'A1', name: '任务', desc: '', memo: '', memo2: '', pre: 'A0' },
  },
  'eo-quests': [
    { api_id: '101', code: 'A1', name_jp: '', desc_jp: '' },
  ],
  // 键与条目自带 code 不一致 = 抓取器错位，必须整包拒收
  'wikiwiki-quests': {
    A2: { code: 'A3', nameJp: 'x', pre: [], condRaw: '', page: 'p' },
  },
  // 既无 yearly 也无 fixed 的空条目 = 解析器漏了表，整包拒收
  'wikiwiki-item-exchange': {
    68: { name: '秋刀魚' },
  },
  'kcwiki-quest-req': {
    quest: { category: 'expedition', objects: [{ times: 1, id: [37] }] },
  },
  'poi-quest-goal': {
    218: {
      type: 1,
      sinking: {
        description: '敌补给舰',
        shipType: '15',
        required: 3,
      },
    },
  },
  'poi-fcd-map': {
    '1-1': { spots: { A: ['0" onload="require(1)', 20] } },
  },
  'equip-upgrades': [
    { eq_id: 1, improvement: {}, convert_to: [], upgrade_for: [] },
  ],
  // 档位写成了表外的字符。这一格错一个字符，排序里它会静默变成「无档」——
  // 而无档与最低档 △ 在游戏里差着四成的加重対空減免，这种错不许悄悄过。
  'equip-aa-evasion': [
    { eq_id: 170, weighted_aa: 0.6, fleet_aa: 1, tier: '弱', basis: '整理参照 · 单源待印证' },
  ],
  // 缺 basis 的行。这一格是玩家判断「这个数可不可信」的唯一依据，
  // 少了它，「照资料整理的」与「游戏里实测过的」就混成了一句话——必须拦。
  'equip-improve': [
    {
      eq_id: 1,
      improvement: [
        {
          convert: null,
          helpers: [{ ship_ids: [3], days: [0] }],
          costs: { fuel: 10, ammo: 10, steel: 0, baux: 0 },
        },
      ],
    },
  ],
  'kcwiki-voice': {
    1: [{ key: '', scene: '', ja: '原文', zh: '译文' }],
  },
  // 缺了 `ja` 这一列。判据 2026-08-22 反转过：原来的坏样本是「混进了 ja」，
  // 现在反过来——台词卷是**对照**功能，少一列就是半张表，所以缺列必须拦。
  // （值可以是空串：上游确实没转日文的行照实空着；缺的是**键**才是坏数据。）
  'kanso-voice': {
    schemaVersion: 1,
    compiledAt: '2026-08-22',
    ships: {
      973: [{ key: '973-1', scene: '入手/登入时', slot: 1, basis: 'wikiwiki-mapped', zh: '译文' }],
    },
  },
  // 槽位越界（官方语音编号只有 1..53）——这个数会被拿去算音轨文件名，必须拦
  'kcwiki-seasonal-voice': {
    schemaVersion: 1,
    seasons: {
      '2026-情人节': { title: '2026年情人节', year: 2026, name: '情人节', page: '季节性/2026年情人节' },
    },
    ships: { 973: [{ season: '2026-情人节', key: '573-Sec1Valentine2026', slot: 54, ja: '原文', zh: '译文' }] },
  },
  'wikiwiki-voice': {
    ship: [{ key: '', voiceId: 54, scene: '入手', ja: '原文', page: '清霜改二' }],
  },
  'wikiwiki-remodel': {
    1040: {
      targetShipId: 1035,
      level: 0,
      page: '',
      raw: '',
      needs: [{ kind: 'slotitem', nameJp: '锅炉', count: 0 }],
    },
  },
  // 有值却说不出凭什么（max 有数、maxState 缺）——空口白话，拒
  'ship-stats': {
    schemaVersion: 1,
    compiledAt: '2026-08-22T00:00:00.000Z',
    voters: {},
    forms: { 916: { name: '大和改二重', evasion: { init: 25, initState: 'single', max: 62, maxState: null } } },
  },
  'wikiwiki-ship-max': {
    593: { shipId: 594, nameJp: '', no: '', kaihi: -1, taisen: 0, sakuteki: 9999 },
  },
  // 空壳条目(四个档案字段全缺)没资格占坑
  'wikiwiki-ship-profile': {
    992: { shipId: 992, nameJp: '杉' },
  },
  'wikiwiki-abyss-voice': {
    955: [{ key: '', scene: '开幕', ja: '原文', page: '深海舰', slot: 'wrong', suffix: 99 }],
  },
  'subtitle-zh': {
    1: { 1: { html: '<img>' } },
  },
  'subtitle-ja': {
    version: { unexpected: true },
  },
  'subtitle-npc': {
    301: [{ name: '明石', jp: '原文', zh: '译文', time: -1 }],
  },
  'subtitle-enemies': {
    enemy: { name: '北方栖姬', jp: '原文', zh: '译文' },
  },
  'fit-bonus': [
    { ids: [1], bonuses: { bonus: { houg: 1 } } },
  ],
  'kcwiki-routing': {
    '1-1': { nodes: [{ from: 'A', rules: '去B' }], credit: '', page: 'page', contentDate: '2021-10-06' },
  },
  'wikiwiki-routing': {
    schemaVersion: 1,
    maps: {
      '1-1': {
        page: '鎮守府海域/1-1',
        sourceUrl: 'https://wikiwiki.jp/kancolle/鎮守府海域/1-1',
        checkedAt: '2026-08-06',
        nodes: [{ from: 'A', routes: [{ to: '<img>', conditionJp: 'x' }] }],
      },
    },
  },
  'kcnav-routing': {
    schemaVersion: 1,
    window: { start: 'today', end: 'tomorrow' },
    minCount: 0,
    maps: {},
  },
  'map-intel': {
    schemaVersion: 1,
    maps: {
      '1-1': {
        source: 'test',
        sourceUrl: 'https://example.test',
        checkedAt: '2026-08-05',
        revision: '1',
        nodes: { A: { emptyDrop: 'unknown', ships: [], enemyComps: [{ formation: 1, ships: [] }] } },
      },
    },
  },
  // labels 比 ships 短一位 = 展示层按下标取名会整体错位，在战斗界面上说错敌人是谁。
  // 长度对不上的标注比没有标注更危险，所以整包拒收而不是丢掉 labels。
  'map-enemy-comps': {
    schemaVersion: 1,
    compiledAt: '2026-08-22',
    maps: {
      '1-1': {
        source: 'kuma 汇编',
        sourceUrl: 'https://example.test',
        checkedAt: '2026-08-22',
        revision: '2026.08.22',
        nodes: {
          A: [{ formation: 1, ships: [1501, 1502], labels: ['駆逐イ級'], votes: ['kcwiki'] }],
        },
      },
    },
  },
  // 掉落汇编包里出现限定期字段 = 有人把两个域混进了一个包。限定期仍归 map-intel 管，
  // 混进来就会有两处各说各的窗口，而且形状对得上、一条报错都不会有。整包拒收。
  'map-drops': {
    schemaVersion: 1,
    compiledAt: '2026-08-22',
    maps: {
      '1-1': {
        source: 'kuma 汇编',
        sourceUrl: 'https://example.test',
        checkedAt: '2026-08-22',
        revision: '2026.08.22',
        nodes: {
          C: {
            emptyDrop: 'unknown',
            ships: [
              {
                id: 457,
                votes: ['kcwiki'],
                limited: { from: '2025-10-29', until: null, lastConfirmedAt: '2026-08-22' },
              },
            ],
          },
        },
      },
    },
  },
  // 台账条目没有 evidence = 说不出凭什么这么写。手工台账里这一条与凭空捏造
  // 无法区分，而它看起来和有凭据的条目一模一样——整包拒收。
  'map-drop-windows': {
    schemaVersion: 1,
    compiledAt: '2026-08-22',
    checkedAt: '2026-06-26',
    source: 'kuma 限定期台账（第一方维护）',
    revision: '2026.08.22',
    maps: {
      '1-1': {
        C: [
          {
            id: 457,
            window: { from: '2025-10-29', until: null, lastConfirmedAt: '2026-06-26' },
            votes: ['wikiwiki'],
          },
        ],
      },
    },
  },
  // 规则引用了一个 equipGroups 里没有的类目键 = 抓取器把类目丢了，整包拒收
  'kcwiki-fit-bonus': {
    schemaVersion: 1,
    equipGroups: {},
    equips: {
      122: {
        id: 122,
        nameJa: '10cm連装高角砲+高射装置',
        nameZh: '10cm连装高角炮',
        rules: [
          {
            row: 1,
            who: { forms: [656] },
            need: { with: [{ group: 'radar-surface' }] },
            gain: { kind: 'flat', flat: { fire: 1 } },
            stack: 'once',
          },
        ],
      },
    },
    unresolved: [],
  },
  'kcwiki-localization': {
    schemaVersion: 1,
    entities: { html: { 1: { ja: 'x', zh: 'y' } } },
  },
}

test('source manifest, validators, and fixtures cover the same 45 lode packs', () => {
  // 包分两类，**合起来**才是校验器与夹具要覆盖的全集：
  //  · 来源登记（scripts/lode-sources.json）：抓来的包与独立生成器包；
  //  · 第一方手工台账（FIRST_PARTY_LODE_IDS）：没有独立生成器的旧台账不进来源登记。
  // 少写一边的后果不是报错，而是新包**没有校验器**却照样被加载。
  const expected = Object.keys(validData).sort()
  const sourceIds = lodeSources.map((source) => source.id)
  assert.equal(expected.length, 45)
  assert.equal(new Set(sourceIds).size, sourceIds.length, 'source manifest contains duplicate ids')
  for (const id of FIRST_PARTY_LODE_IDS) {
    const registered = lodeSources.find((source) => source.id === id)
    if (registered) {
      assert.equal(registered.selfFetch, false, `${id} 是独立生成器包，通用抓取必须跳过`)
    }
  }
  assert.deepEqual([...new Set([...sourceIds, ...FIRST_PARTY_LODE_IDS])].sort(), expected)
  assert.deepEqual([...SUPPORTED_LODE_IDS].sort(), expected)
  assert.deepEqual(Object.keys(invalidData).sort(), expected)
  for (const id of expected) {
    assert.equal(validateLodePack(pack(id, validData[id])).ok, true, `${id} valid fixture`)
    assert.equal(validateLodePack(pack(id, invalidData[id])).ok, false, `${id} invalid fixture`)
  }
})

test('维护者侧专用的 eo-quests 运行时零读取，且打包一定被排除', () => {
  // 这个包是 EO 的 Quests.json（NOASSERTION），只在维护流水线里用：
  // 给 wikiwiki-quests 做任务码空间公证、喂任务前提三方对账、
  // 给仲裁台账当日文原文的次级出处（desc_jp）。三处都在 scripts/ 里，跑的是维护者。
  //
  // 所以它有两条互相独立的防线，两条都得钉住——**只钉一条，另一条哪天松了没人知道**：
  //  ① 运行时永不读：不在 CONSUMED_LODES 里（健康度面板的判据，也是 src/ 的读取清单）；
  //  ② 打包永不带：排除清单真的拦得住这条路径（拿真路径跑，不是匹配源码文本）。
  assert.ok(
    !CONSUMED_LODE_IDS.includes('eo-quests'),
    'eo-quests 进了运行时读取清单——它是维护者侧的包，不该被 src/ 读',
  )
  assert.equal(isPackageIgnored('/assets/lodes/eo-quests.json'), true)
  // 反向：正常随包的矿脉不许被这条规则误伤（正则写宽了就会一片一片地掉）
  for (const id of ['quests-scn', 'kcwiki-quest-req', 'poi-quest-goal', 'poi-fcd-map']) {
    assert.equal(
      isPackageIgnored(`/assets/lodes/${id}.json`),
      false,
      `${id} 被打包排除清单误伤了`,
    )
  }
  // 已退场的 EO 判定包：清单里不该再有它，运行时也不该再读
  assert.ok(!CONSUMED_LODE_IDS.includes('quest-trackers'))
  assert.ok(!lodeSources.some((source) => source.id === 'quest-trackers'))
  assert.ok(!SUPPORTED_LODE_IDS.includes?.('quest-trackers') && !new Set(SUPPORTED_LODE_IDS).has('quest-trackers'))
})

test('unknown packs and dangerous or unbounded JSON trees are rejected', () => {
  assert.equal(validateLodePack(pack('unknown-pack', {})).ok, false)

  const dangerous = JSON.parse('{"__proto__":{"polluted":true}}')
  assert.equal(validateLodePack(pack('quests-scn', dangerous)).ok, false)

  let nested = 'leaf'
  for (let depth = 0; depth < 18; depth++) nested = [nested]
  assert.equal(validateLodePack(pack('eo-quests', nested)).ok, false)

  const tooLong = structuredClone(validData['quests-scn'])
  tooLong[101].desc = 'x'.repeat(20_001)
  assert.equal(validateLodePack(pack('quests-scn', tooLong)).ok, false)

  // 分边条目：边不声明来路（fromShipId）就没法归边，必须拒收
  const edgeWithoutFrom = structuredClone(validData['wikiwiki-remodel'])
  delete edgeWithoutFrom[1040].edges[1].fromShipId
  assert.equal(validateLodePack(pack('wikiwiki-remodel', edgeWithoutFrom)).ok, false)

  const edgeBadSource = structuredClone(validData['wikiwiki-remodel'])
  edgeBadSource[1040].edges[0].source = 'guess'
  assert.equal(validateLodePack(pack('wikiwiki-remodel', edgeBadSource)).ok, false)

  const injectedExpedition = structuredClone(validData['wikiwiki-expedition'])
  injectedExpedition.E1.rewards.fuel = [
    '<img src=x onerror=require("child_process").exec("calc")>',
    1,
  ]
  injectedExpedition.E1.rewards.shipExp = '<svg onload=require("child_process").exec("calc")>'
  assert.equal(
    validateLodePack(pack('wikiwiki-expedition', injectedExpedition)).ok,
    false,
  )
})

test('map-intel source text is escaped at every combat rendering site', () => {
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  // 掉落与编成两格 2026-08-22 起各读各自汇编包的来源（`mapDropsInfo()` /
  // `mapEnemyCompsInfo()`，汇编层没覆盖的图退回底座）。名字换过两轮了，
  // 所以钉的是「**每一处** `.source` 都被 esc 包着」，不钉具体叫什么。
  const occurrences = [...combat.matchAll(/\b\w+\.source\b/g)]
  assert.ok(occurrences.length >= 2, `di.ts 里只找到 ${occurrences.length} 处来源文本`)
  assert.equal([...combat.matchAll(/esc\(\w+\.source\)/g)].length, occurrences.length)
  assert.match(combat, /核对 \$\{esc\(\w+\.checkedAt\)\}/)
})

test('driver-created cwd junk stays out of version control', () => {
  const gitignore = fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8')
  assert.match(gitignore, /^\/NVIDIA Corporation\/$/m)
})

test('validated lode files are cached only while size and mtime stay unchanged', () => {
  const loader = fs.readFileSync(new URL('../src/main/lode.ts', import.meta.url), 'utf8')
  assert.match(loader, /const packCache = new Map<string, CachedPack>\(\)/)
  assert.match(loader, /cached\.mtimeMs === stat\.mtimeMs && cached\.size === stat\.size/)
  assert.match(loader, /packCache\.set\(file, \{ mtimeMs: stat\.mtimeMs, size: stat\.size, pack \}\)/)
})

test('fact-source refreshes fail visibly, cache daily wikiwiki pages, and never automate KCNav', () => {
  const fetcher = fs.readFileSync(new URL('../scripts/fetch-lodes.mjs', import.meta.url), 'utf8')
  const sources = JSON.parse(
    fs.readFileSync(new URL('../scripts/lode-sources.json', import.meta.url), 'utf8'),
  )
  const remodel = sources.find((source) => source.id === 'wikiwiki-remodel')
  const kcnav = sources.find((source) => source.id === 'kcnav-routing')
  const routing = sources.find((source) => source.id === 'wikiwiki-routing')

  assert.equal(remodel.dailyCache, true)
  assert.equal(kcnav.manualImport, true)
  assert.equal(routing.selfFetch, true)
  assert.match(fetcher, /failedSources\.add\(src\.id\)/)
  assert.match(fetcher, /交叉对账已跳过：本轮事实包抓取失败/)
  assert.match(fetcher, /process\.exitCode = 1/)
  assert.match(fetcher, /source\.manualImport/)
  assert.match(fetcher, /使用当日源缓存/)
})

test('source reconciliation compares official expedition facts before community fallbacks', () => {
  const reconcile = fs.readFileSync(
    new URL('../scripts/lib/lode-reconcile.mjs', import.meta.url),
    'utf8',
  )
  assert.match(reconcile, /findNestedArray\(raw, 'api_mst_mission'\)/)
  assert.match(reconcile, /\['time', Number\(mission\.api_time\), timeMinutes\(entry\?\.time\)\]/)
  assert.match(reconcile, /\['minShips', Number\(mission\.api_deck_num\), Number\(entry\?\.minShips\)\]/)
  assert.match(reconcile, /\['useFuel', Number\(mission\.api_use_fuel\), percentFromText\(entry\?\.useFuelText\)\]/)
  assert.match(reconcile, /apiNativeCoverage/)
  assert.match(reconcile, /difficulties: master\.missions\.filter/)
  assert.doesNotMatch(reconcile, /difficultyValue/)
})

// ---- meta.note 是玩家可见文案（2026-08-24「源」悬停批） ----
//
// lodeCredit() 把 meta.note 渲染进模块里那枚「源」的悬停，玩家一 hover 就整段读到。
// 这个字段此前是两拨人共用的：维护者把换源考古、逐条对账、pageid、脚本路径、⚠️ 标记
// 全堆进去（equip-upgrades 那条到过 1522 字），玩家悬停读到的是一段开发日志。
//
// 拆开之后 note 只留一两句人话，考古进 maintainerNote（抓取器一行都不读它）。
// 护栏必须钉在**数据**上，不能只匹配抓取器源码文本——note 的值是从
// scripts/lode-sources.json 抄进包里的，源码写得再对，清单里塞回一段考古照样上屏。

/** 玩家 note 的字数上限。超了就说明又在里面讲道理了，收进 maintainerNote。 */
const NOTE_MAX = 140

/** 维护者词汇：出现在玩家 note 里即为漏网。 */
const NOTE_BANNED = [
  [/⚠/u, '警示标记（⚠）是维护者备忘的记号，玩家 note 里不该有'],
  [/pageid/iu, 'pageid 是抓取途径'],
  [/而是/u, '「不是 A 而是 B」是换源考古的句式'],
  [/对账/u, '逐条对账是维护者的活'],
  [/换源/u, '换源史属于 maintainerNote'],
  [/模块:/u, 'wiki 模块名是抓取途径'],
  [/\bapi_/u, '游戏 API 字段名不是玩家词汇'],
  [/(?:scripts|src)\//u, '脚本/源码路径不进玩家文案'],
  [/\.(?:mjs|ts)\b/u, '文件名不进玩家文案'],
  [/§/u, '普查章节号是维护者索引'],
  [/\*\*/u, '行内加粗强调是 AI 腔（七之五②）'],
  [/——/u, '破折号连环从句是 AI 腔（七之五②）'],
]

/**
 * 这一改（2026-08-24）从 note 里搬走过考古的包。
 * 凡在这张名单上的，考古必须落得下——否则就是「删了没搬」，那些事实会静默消失。
 * 新增包不强制上榜：没有考古就不必编一段。
 */
const NOTE_MIGRATED_IDS = Object.freeze([
  'abyssal-stats', 'akashi-list', 'build-recipes', 'dev-recipes', 'eo-quests',
  'equip-upgrades', 'event-bonus', 'fit-bonus', 'kanso-voice', 'kcnav-routing',
  'kcwiki-bgm', 'kcwiki-expedition', 'kcwiki-fit-bonus', 'kcwiki-localization',
  'kcwiki-quest-req', 'kcwiki-routing', 'kcwiki-seasonal-voice', 'kcwiki-ships',
  'kcwiki-voice', 'map-drop-windows', 'map-drops', 'map-enemy-comps', 'map-intel',
  'poi-fcd-map', 'poi-quest-goal', 'quests-scn', 'ship-exp', 'ship-stats',
  'subtitle-enemies', 'subtitle-ja', 'subtitle-npc', 'subtitle-zh',
  'wikiwiki-abyss-voice', 'wikiwiki-expedition', 'wikiwiki-item-exchange',
  'wikiwiki-quests', 'wikiwiki-remodel', 'wikiwiki-routing', 'wikiwiki-ship-max',
  'wikiwiki-ship-profile', 'wikiwiki-voice',
])

const checkPlayerNote = (where, note) => {
  assert.equal(typeof note, 'string', `${where} 没有 meta.note`)
  assert.ok(note.trim().length > 0, `${where} 的 note 是空的`)
  assert.ok(
    [...note].length <= NOTE_MAX,
    `${where} 的 note 有 ${[...note].length} 字（上限 ${NOTE_MAX}）：讲道理的部分收进 maintainerNote`,
  )
  for (const [pattern, why] of NOTE_BANNED) {
    assert.doesNotMatch(note, pattern, `${where} 的 note 里有维护者内容——${why}\n  note: ${note}`)
  }
  // 短 UI 文案的标点体例（2026-08-22）：行尾不写句号
  assert.ok(!note.endsWith('。'), `${where} 的 note 行尾带了句号`)
}

const checkArchive = (where, archive) => {
  assert.ok(Array.isArray(archive), `${where} 缺 maintainerNote——考古是不是删了没搬？`)
  assert.ok(archive.length > 0, `${where} 的 maintainerNote 是空数组`)
  for (const segment of archive) {
    assert.equal(typeof segment, 'string', `${where} 的 maintainerNote 里有非字符串`)
    assert.ok(segment.trim().length > 0, `${where} 的 maintainerNote 里有空段`)
  }
}

test('资料包的 meta.note 是给玩家的一两句人话，考古另住 maintainerNote', () => {
  // ① 抓取清单：note 是模板的唯一出处（fetch-lodes 照抄进 meta.note），
  //    所以清单红了就等于「下次重抓会把考古再写回玩家眼前」
  for (const source of lodeSources) {
    checkPlayerNote(`lode-sources.json/${source.id}`, source.note)
    if (NOTE_MIGRATED_IDS.includes(source.id)) {
      checkArchive(`lode-sources.json/${source.id}`, source.maintainerNote)
    }
  }
  // maintainerNote 绝不能被抄进包里：它一旦进 meta 就会被 lodeCredit 渲染出来
  const fetcher = fs.readFileSync(new URL('../scripts/fetch-lodes.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(fetcher, /maintainerNote:\s*src\.maintainerNote/)

  // ② 本地真包：抓来的包按清单核对，手工台账按自己的 meta 核对。
  //    非随包的那些在干净检出里根本不存在（gitignore），所以逐个判存在性。
  const dir = new URL('../assets/lodes/', import.meta.url)
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
  assert.ok(files.length >= 20, `assets/lodes 只剩 ${files.length} 个包？`)
  let checked = 0
  for (const file of files) {
    const id = file.slice(0, -5)
    const meta = JSON.parse(fs.readFileSync(new URL(file, dir), 'utf8')).meta
    assert.equal(meta.id, id, `${file} 的 meta.id 与文件名对不上`)
    checkPlayerNote(`assets/lodes/${file}`, meta.note)
    if (FIRST_PARTY_LODE_IDS.includes(id)) {
      // 手工台账不在抓取清单里（fetch-lodes 会逐条遍历，没有 url 的条目会炸），
      // 所以它们的考古只能住在包自己的 meta 里
      checkArchive(`assets/lodes/${file}`, meta.maintainerNote)
      checked++
      continue
    }
    const source = lodeSources.find((entry) => entry.id === id)
    assert.ok(source, `${file} 既不在抓取清单里也不是手工台账`)
    // 包里不该带 maintainerNote：抓取器不写它，写了就是有人手改包时搬错了地方
    assert.equal(meta.maintainerNote, undefined, `${file} 的 meta 里出现了 maintainerNote`)
    // map-intel 的 note 由三个活动流水线脚本覆写（fetch-map-intel / …-event / archive-…），
    // 与清单那一份天然不同，只查文案体例不查一致
    if (id !== 'map-intel') {
      assert.equal(
        meta.note,
        source.note,
        `${file} 的 note 与清单不一致——改了清单没重出包，玩家看到的还是旧那句`,
      )
    }
    checked++
  }
  assert.equal(checked, files.length)
})
