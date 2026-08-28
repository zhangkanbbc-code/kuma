const quest = (code, desc = '', memo2 = '') => ({
  code,
  desc,
  memo: '',
  memo2,
  name: `合成任务 ${code}`,
  pre: [],
})

// 这些是专供离线 CI 的最小合成包，不复制或分发完整社区资料。
// 每条只保留某项规则测试实际需要的结构与关键词。
export const syntheticQuestPack = {
  meta: { id: 'quests-scn', version: 'test-fixture', source: 'synthetic' },
  data: {
    103: quest('A3', '以轻巡洋舰为旗舰，加上三艘驱逐舰编成水雷战队'),
    201: quest('Bd1', '舰队出击并战胜敌舰队', '出击胜利一次'),
    210: quest('Bd3', '舰队全力出击', '十场战斗可完成'),
    211: quest('Bd4', '击沉敌方三艘正规空母或轻空母', '击沉敌方3艘正规空母或轻空母'),
    214: quest('Bw1', '复合出击任务', '出击36次 进入BOSS点24次 BOSS战胜利12次 S胜6次'),
    216: quest('Bd2', '舰队出击', '出击一次（失败可完成）'),
    226: quest('Bd7', '击破南西群岛海域任意BOSS点五次', '击破「南西群岛海域」任意BOSS点五次'),
    236: quest('B136', '海风改二旗舰出击'),
    319: quest('C17', '本日演习胜利4次'),
    410: quest('Dw2', '东京急行系远征成功一次'),
    504: quest('Ed2', '对各舰实施15次以上的补给'),
    605: quest('Fd1', '在工厂开发新装备一次'),
    626: quest('Fm1', '凤翔秘书舰执行舰战转换'),
    657: quest('Fy1', '废弃「小口径主炮」×6「中口径主炮」×5「鱼雷」×4，准备4000钢材'),
    661: quest('F53', '废弃「副炮」×10，准备6000钢材'),
    662: quest('F54', '废弃「中口径主炮」×10，准备12000钢材'),
    663: quest('Fq3', '废弃「大口径主炮」×10，准备18000钢材'),
    665: quest('F57', '废弃「小口径主炮」×16，准备12000燃料'),
    673: quest('Fd7', '废弃四个「小口径主炮」'),
    675: quest('Fq4', '废弃「舰载战斗机」×6「机枪」×4，准备800铝土'),
    676: quest('Fw3', '废弃「中口径主炮」×3「副炮」×3「桶(运输用)」×1，准备钢材2400'),
    679: quest('F71', '废弃「中口径主炮」×6「副炮」×3，准备铝土900'),
    682: quest('F73', '废弃「中口径主炮」×4「大口径主炮」×4，准备500燃料'),
    691: quest('F82', '废弃「中口径主炮」×4「副炮」×4「机枪」×4，准备1600铝土'),
    692: quest('F83', '废弃「小口径主炮」×5「大口径主炮」×5「水侦」×5，准备钢材3000'),
    920: quest('B148', 'Fletcher改 Mod.2旗舰和美英澳荷舰娘组成舰队'),
  },
}

export const syntheticKcwikiRequirements = {
  103: {
    category: 'fleet',
    groups: [{ ship: '軽巡', flagship: true }, { ship: '駆逐', amount: 3 }],
  },
  145: {
    category: 'fleet',
    groups: [{ shipclass: ['大和', '長門', '伊勢', '扶桑'], amount: 3 }, { ship: '軽巡', amount: 1 }],
  },
  152: {
    category: 'fleet',
    groups: [
      { ship: '鳥海改二', flagship: true },
      { ship: ['天龍', '古鷹', '加古', '青葉', '夕張', '衣笠'], select: 5 },
    ],
    fleetid: 1,
  },
  158: {
    category: 'fleet',
    groups: [{ ship: '長門改二', flagship: true }, { ship: '陸奥改二', place: 2 }],
  },
  211: { category: 'sink', amount: 3, ship: '敵空母' },
  214: { category: 'a-gou' },
  226: { category: 'sortie', map: '2-1 ~ 2-5', boss: true, result: 'B', times: 5 },
  410: { category: 'expedition', objects: [{ times: 1, id: [37, 38] }] },
  626: {
    category: 'modelconversion',
    equipment: '零式艦戦21型',
    secretary: '鳳翔',
    scraps: [
      { name: '零式艦戦21型', amount: 2 },
      { name: '九六式艦戦', amount: 1 },
    ],
    fullyskilled: true,
    use_skilled_crew: true,
  },
  673: { category: 'scrapequipment', list: [{ name: '小口径主砲', amount: 4 }] },
}

export const syntheticKcwikiPack = {
  meta: { id: 'kcwiki-quest-req', version: 'test-fixture', source: 'synthetic' },
  data: syntheticKcwikiRequirements,
}

export const syntheticPoiPack = {
  meta: { id: 'poi-quest-goal', version: 'test-fixture', source: 'synthetic' },
  data: {
    605: {
      type: 1,
      create_item: { description: '开发', required: 1, init: 0 },
    },
  },
}

export const syntheticLocalizationPack = {
  meta: { id: 'kcwiki-localization', version: 'test-fixture', source: 'synthetic' },
  data: {
    entities: {
      equipType: {
        1: { ja: '小口径主砲', zh: '小口径主炮' },
        2: { ja: '中口径主砲', zh: '中口径主炮' },
        3: { ja: '大口径主砲', zh: '大口径主炮' },
        4: { ja: '副砲', zh: '副炮' },
        5: { ja: '魚雷', zh: '鱼雷' },
        6: { ja: '艦上戦闘機', zh: '舰载战斗机' },
      },
    },
  },
}

export const syntheticExpeditionPack = {
  meta: { id: 'kcwiki-expedition', version: 'test-fixture', source: 'synthetic' },
  data: {},
}
