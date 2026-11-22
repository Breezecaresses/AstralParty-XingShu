// Auto-generated verified in-game character emote catalog cross-checked against public/catalog/UT_Item_Emoji_*.webp
import steamEmoteRevisions from './steamAnimatedEmotes.generated.json' with { type: 'json' };
import { assetUrl, installedArtworkUrl } from './runtime';

const steamRevisions: Readonly<Record<string, string>> = import.meta.env?.MODE === 'launcher' ? {} : steamEmoteRevisions;

export interface GameEmoteItem {
  id: string;
  name: string;
  characterId: string;
  characterName: string;
  characterEnName: string;
  isDefault: boolean;
  animated: boolean;
}

export interface GameEmoteCharacterGroup {
  id: string;
  name: string;
  enName: string;
  avatar: string;
  emotes: GameEmoteItem[];
}

const RAW_GROUPS: Array<{
  id: string;
  name: string;
  enName: string;
  avatar: string;
  emotes: Array<{ id: string; name: string; isDefault: boolean; animated: boolean }>;
}> = [
  {
    "id": "101",
    "name": "帕露南",
    "enName": "101",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_101_01",
        "name": "商业之主表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_101_02",
        "name": "商业之主表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_101_03",
        "name": "商业之主表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_101_04",
        "name": "商业之主表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_101_05",
        "name": "商业之主表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_101_06",
        "name": "商业之主表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_101_07",
        "name": "商业之主表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_101_08",
        "name": "商业之主表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_101_09",
        "name": "商业之主表情9（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_101_10",
        "name": "商业之主表情10（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_101_11",
        "name": "商业之主表情11（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_101_12",
        "name": "商业之主表情12",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_101_13",
        "name": "商业之主表情13",
        "isDefault": false,
        "animated": false
      }
    ]
  },
  {
    "id": "102",
    "name": "芬妮",
    "enName": "102",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_102_01",
        "name": "古怪神探表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_102_02",
        "name": "古怪神探表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_102_03",
        "name": "古怪神探表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_102_04",
        "name": "古怪神探表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_102_05",
        "name": "古怪神探表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_102_06",
        "name": "古怪神探表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_102_07",
        "name": "古怪神探表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_102_08",
        "name": "古怪神探表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_102_09",
        "name": "古怪神探表情9",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_102_10",
        "name": "古怪神探表情10（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_102_11",
        "name": "古怪神探表情11",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_102_12",
        "name": "古怪神探表情12（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_102_13",
        "name": "古怪神探表情13（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_102_14",
        "name": "古怪神探表情14（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_102_15",
        "name": "古怪神探表情15（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_102_16",
        "name": "古怪神探表情16",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_102_17",
        "name": "古怪神探表情17",
        "isDefault": false,
        "animated": false
      }
    ]
  },
  {
    "id": "103",
    "name": "阿兰娜",
    "enName": "103",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_103_01",
        "name": "社恐修女表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_103_02",
        "name": "社恐修女表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_103_03",
        "name": "社恐修女表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_103_04",
        "name": "社恐修女表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_103_05",
        "name": "社恐修女表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_103_06",
        "name": "社恐修女表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_103_07",
        "name": "社恐修女表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_103_08",
        "name": "社恐修女表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_103_09",
        "name": "社恐修女表情9",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_103_10",
        "name": "社恐修女表情10（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_103_11",
        "name": "社恐修女表情11",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_103_12",
        "name": "社恐修女表情12（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_103_13",
        "name": "社恐修女表情13（动态）",
        "isDefault": false,
        "animated": true
      }
    ]
  },
  {
    "id": "104",
    "name": "小町",
    "enName": "104",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_104_01",
        "name": "暗影忍者表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_104_02",
        "name": "暗影忍者表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_104_03",
        "name": "暗影忍者表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_104_04",
        "name": "暗影忍者表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_104_05",
        "name": "暗影忍者表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_104_06",
        "name": "暗影忍者表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_104_07",
        "name": "暗影忍者表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_104_08",
        "name": "暗影忍者表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_104_09",
        "name": "暗影忍者表情9（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_104_10",
        "name": "暗影忍者表情10",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_104_11",
        "name": "暗影忍者表情11（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_104_12",
        "name": "暗影忍者表情12",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_104_13",
        "name": "暗影忍者表情13（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_104_14",
        "name": "暗影忍者表情14",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_104_15",
        "name": "暗影忍者表情15",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_104_16",
        "name": "暗影忍者表情16",
        "isDefault": false,
        "animated": false
      }
    ]
  },
  {
    "id": "105",
    "name": "派德曼",
    "enName": "105",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_105_01",
        "name": "社员叔叔表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_105_02",
        "name": "社员叔叔表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_105_03",
        "name": "社员叔叔表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_105_04",
        "name": "社员叔叔表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_105_05",
        "name": "社员叔叔表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_105_06",
        "name": "社员叔叔表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_105_07",
        "name": "社员叔叔表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_105_08",
        "name": "社员叔叔表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_105_09",
        "name": "社员叔叔表情9（动态）",
        "isDefault": false,
        "animated": true
      }
    ]
  },
  {
    "id": "106",
    "name": "帕帕拉",
    "enName": "106",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_106_01",
        "name": "猩红辣妹表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_106_02",
        "name": "猩红辣妹表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_106_03",
        "name": "猩红辣妹表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_106_04",
        "name": "猩红辣妹表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_106_05",
        "name": "猩红辣妹表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_106_06",
        "name": "猩红辣妹表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_106_07",
        "name": "猩红辣妹表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_106_08",
        "name": "猩红辣妹表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_106_09",
        "name": "猩红辣妹表情9（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_106_10",
        "name": "猩红辣妹表情10",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_106_11",
        "name": "猩红辣妹表情11（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_106_12",
        "name": "猩红辣妹表情12",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_106_13",
        "name": "猩红辣妹表情13（动态）",
        "isDefault": false,
        "animated": true
      }
    ]
  },
  {
    "id": "107",
    "name": "恋",
    "enName": "107",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_107_01",
        "name": "游戏大师表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_107_02",
        "name": "游戏大师表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_107_03",
        "name": "游戏大师表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_107_04",
        "name": "游戏大师表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_107_05",
        "name": "游戏大师表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_107_06",
        "name": "游戏大师表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_107_07",
        "name": "游戏大师表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_107_08",
        "name": "游戏大师表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_107_09",
        "name": "游戏大师表情9（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_107_10",
        "name": "游戏大师表情10（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_107_11",
        "name": "游戏大师表情11（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_107_12",
        "name": "游戏大师表情12",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_107_13",
        "name": "游戏大师表情13（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_107_14",
        "name": "游戏大师表情14",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_107_15",
        "name": "游戏大师表情15（动态）",
        "isDefault": false,
        "animated": true
      }
    ]
  },
  {
    "id": "108",
    "name": "米米",
    "enName": "108",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_108_01",
        "name": "看板娘表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_108_02",
        "name": "看板娘表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_108_03",
        "name": "看板娘表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_108_04",
        "name": "看板娘表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_108_05",
        "name": "看板娘表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_108_06",
        "name": "看板娘表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_108_07",
        "name": "看板娘表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_108_08",
        "name": "看板娘表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_108_09",
        "name": "看板娘表情9",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_108_10",
        "name": "看板娘表情10（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_108_11",
        "name": "看板娘表情11（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_108_12",
        "name": "看板娘表情12（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_108_13",
        "name": "看板娘表情13",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_108_14",
        "name": "看板娘表情14",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_108_15",
        "name": "看板娘表情15",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_108_16",
        "name": "看板娘表情16（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_108_17",
        "name": "看板娘表情17",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_108_18",
        "name": "看板娘表情18（动态）",
        "isDefault": false,
        "animated": true
      }
    ]
  },
  {
    "id": "109",
    "name": "Z3000",
    "enName": "109",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_109_01",
        "name": "垃圾箱表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_109_02",
        "name": "垃圾箱表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_109_03",
        "name": "垃圾箱表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_109_04",
        "name": "垃圾箱表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_109_05",
        "name": "垃圾箱表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_109_06",
        "name": "垃圾箱表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_109_07",
        "name": "垃圾箱表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_109_08",
        "name": "垃圾箱表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_109_09",
        "name": "垃圾箱表情9（动态）",
        "isDefault": false,
        "animated": true
      }
    ]
  },
  {
    "id": "110",
    "name": "潘大猛",
    "enName": "110",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_110_01",
        "name": "肉弹战车表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_110_02",
        "name": "肉弹战车表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_110_03",
        "name": "肉弹战车表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_110_04",
        "name": "肉弹战车表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_110_05",
        "name": "肉弹战车表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_110_06",
        "name": "肉弹战车表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_110_07",
        "name": "肉弹战车表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_110_08",
        "name": "肉弹战车表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_110_09",
        "name": "肉弹战车表情9（动态）",
        "isDefault": false,
        "animated": true
      }
    ]
  },
  {
    "id": "111",
    "name": "墨影",
    "enName": "111",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_111_01",
        "name": "小猎手表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_111_02",
        "name": "小猎手表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_111_03",
        "name": "小猎手表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_111_04",
        "name": "小猎手表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_111_05",
        "name": "小猎手表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_111_06",
        "name": "小猎手表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_111_07",
        "name": "小猎手表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_111_08",
        "name": "小猎手表情8",
        "isDefault": false,
        "animated": false
      }
    ]
  },
  {
    "id": "112",
    "name": "璐璐",
    "enName": "112",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_112_01",
        "name": "史莱姆表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_112_02",
        "name": "史莱姆表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_112_03",
        "name": "史莱姆表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_112_04",
        "name": "史莱姆表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_112_05",
        "name": "史莱姆表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_112_06",
        "name": "史莱姆表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_112_07",
        "name": "史莱姆表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_112_08",
        "name": "史莱姆表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_112_09",
        "name": "史莱姆表情9",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_112_10",
        "name": "史莱姆表情10（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_112_11",
        "name": "史莱姆表情11",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_112_12",
        "name": "史莱姆表情12（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_112_13",
        "name": "史莱姆表情13（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_112_14",
        "name": "史莱姆表情14（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_112_15",
        "name": "史莱姆表情15（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_112_16",
        "name": "史莱姆表情16",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_112_17",
        "name": "史莱姆表情17",
        "isDefault": false,
        "animated": false
      }
    ]
  },
  {
    "id": "113",
    "name": "姬梦枫",
    "enName": "113",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_113_01",
        "name": "旗袍娘表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_113_02",
        "name": "旗袍娘表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_113_03",
        "name": "旗袍娘表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_113_04",
        "name": "旗袍娘表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_113_05",
        "name": "旗袍娘表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_113_06",
        "name": "旗袍娘表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_113_07",
        "name": "旗袍娘表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_113_08",
        "name": "旗袍娘表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_113_09",
        "name": "旗袍娘表情9（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_113_10",
        "name": "旗袍娘表情10（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_113_11",
        "name": "旗袍娘表情11",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_113_12",
        "name": "旗袍娘表情12",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_113_13",
        "name": "旗袍娘表情13（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_113_14",
        "name": "旗袍娘表情14",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_113_15",
        "name": "旗袍娘表情15",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_113_16",
        "name": "旗袍娘表情16",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_113_17",
        "name": "旗袍娘表情17（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_113_18",
        "name": "旗袍娘表情18",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_113_19",
        "name": "旗袍娘表情19（动态）",
        "isDefault": false,
        "animated": true
      }
    ]
  },
  {
    "id": "114",
    "name": "蓝海晴",
    "enName": "114",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_114_01",
        "name": "命运少女表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_114_02",
        "name": "命运少女表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_114_03",
        "name": "命运少女表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_114_04",
        "name": "命运少女表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_114_05",
        "name": "命运少女表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_114_06",
        "name": "命运少女表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_114_07",
        "name": "命运少女表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_114_08",
        "name": "命运少女表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_114_09",
        "name": "命运少女表情9（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_114_10",
        "name": "命运少女表情10（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_114_11",
        "name": "命运少女表情11（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_114_12",
        "name": "命运少女表情12",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_114_13",
        "name": "命运少女表情13（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_114_14",
        "name": "命运少女表情14",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_114_15",
        "name": "命运少女表情15（动态）",
        "isDefault": false,
        "animated": true
      }
    ]
  },
  {
    "id": "115",
    "name": "美咲",
    "enName": "115",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_115_01",
        "name": "太刀使表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_115_02",
        "name": "太刀使表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_115_03",
        "name": "太刀使表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_115_04",
        "name": "太刀使表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_115_05",
        "name": "太刀使表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_115_06",
        "name": "太刀使表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_115_07",
        "name": "太刀使表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_115_08",
        "name": "太刀使表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_115_09",
        "name": "太刀使表情9（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_115_10",
        "name": "太刀使表情10",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_115_11",
        "name": "太刀使表情11（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_115_12",
        "name": "太刀使表情12",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_115_13",
        "name": "太刀使表情13（动态）",
        "isDefault": false,
        "animated": true
      }
    ]
  },
  {
    "id": "116",
    "name": "娜蒂斯",
    "enName": "116",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_116_01",
        "name": "绿洲女王表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_116_02",
        "name": "绿洲女王表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_116_03",
        "name": "绿洲女王表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_116_04",
        "name": "绿洲女王表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_116_05",
        "name": "绿洲女王表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_116_06",
        "name": "绿洲女王表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_116_07",
        "name": "绿洲女王表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_116_08",
        "name": "绿洲女王表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_116_09",
        "name": "绿洲女王表情9",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_116_10",
        "name": "绿洲女王表情10（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_116_11",
        "name": "绿洲女王表情11",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_116_12",
        "name": "绿洲女王表情12（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_116_13",
        "name": "绿洲女王表情13（动态）",
        "isDefault": false,
        "animated": true
      }
    ]
  },
  {
    "id": "117",
    "name": "茉莉",
    "enName": "117",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_117_01",
        "name": "家政机器人表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_117_02",
        "name": "家政机器人表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_117_03",
        "name": "家政机器人表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_117_04",
        "name": "家政机器人表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_117_05",
        "name": "家政机器人表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_117_06",
        "name": "家政机器人表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_117_07",
        "name": "家政机器人表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_117_08",
        "name": "家政机器人表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_117_09",
        "name": "家政机器人表情9",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_117_10",
        "name": "家政机器人表情10（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_117_11",
        "name": "家政机器人表情11",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_117_12",
        "name": "家政机器人表情12（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_117_13",
        "name": "家政机器人表情13（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_117_14",
        "name": "家政机器人表情14（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_117_15",
        "name": "家政机器人表情15（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_117_16",
        "name": "家政机器人表情16",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_117_17",
        "name": "家政机器人表情17",
        "isDefault": false,
        "animated": false
      }
    ]
  },
  {
    "id": "118",
    "name": "阿尔",
    "enName": "118",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_118_01",
        "name": "暗区少主表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_118_02",
        "name": "暗区少主表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_118_03",
        "name": "暗区少主表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_118_04",
        "name": "暗区少主表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_118_05",
        "name": "暗区少主表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_118_06",
        "name": "暗区少主表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_118_07",
        "name": "暗区少主表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_118_08",
        "name": "暗区少主表情8",
        "isDefault": false,
        "animated": false
      }
    ]
  },
  {
    "id": "119",
    "name": "星魅琉华",
    "enName": "119",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_119_01",
        "name": "午夜闪光表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_119_02",
        "name": "午夜闪光表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_119_03",
        "name": "午夜闪光表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_119_04",
        "name": "午夜闪光表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_119_05",
        "name": "午夜闪光表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_119_06",
        "name": "午夜闪光表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_119_07",
        "name": "午夜闪光表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_119_08",
        "name": "午夜闪光表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_119_09",
        "name": "午夜闪光表情9（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_119_10",
        "name": "午夜闪光表情10",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_119_11",
        "name": "午夜闪光表情11（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_119_12",
        "name": "午夜闪光表情12",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_119_13",
        "name": "午夜闪光表情13（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_119_14",
        "name": "午夜闪光表情14（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_119_15",
        "name": "午夜闪光表情15（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_119_16",
        "name": "午夜闪光表情16",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_119_17",
        "name": "午夜闪光表情17",
        "isDefault": false,
        "animated": false
      }
    ]
  },
  {
    "id": "120",
    "name": "南希露",
    "enName": "120",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_120_01",
        "name": "网络魅影表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_120_02",
        "name": "网络魅影表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_120_03",
        "name": "网络魅影表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_120_04",
        "name": "网络魅影表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_120_05",
        "name": "网络魅影表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_120_06",
        "name": "网络魅影表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_120_07",
        "name": "网络魅影表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_120_08",
        "name": "网络魅影表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_120_09",
        "name": "网络魅影表情9（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_120_10",
        "name": "网络魅影表情10",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_120_11",
        "name": "网络魅影表情11（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_120_12",
        "name": "网络魅影表情12",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_120_13",
        "name": "网络魅影表情13（动态）",
        "isDefault": false,
        "animated": true
      }
    ]
  },
  {
    "id": "121",
    "name": "凛",
    "enName": "121",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_121_01",
        "name": "新人调查员表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_121_02",
        "name": "新人调查员表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_121_03",
        "name": "新人调查员表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_121_04",
        "name": "新人调查员表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_121_05",
        "name": "新人调查员表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_121_06",
        "name": "新人调查员表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_121_07",
        "name": "新人调查员表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_121_08",
        "name": "新人调查员表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_121_09",
        "name": "新人调查员表情9",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_121_10",
        "name": "新人调查员表情10（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_121_11",
        "name": "新人调查员表情11",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_121_12",
        "name": "新人调查员表情12（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_121_13",
        "name": "新人调查员表情13",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_121_14",
        "name": "新人调查员表情14",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_121_15",
        "name": "新人调查员表情15",
        "isDefault": false,
        "animated": false
      }
    ]
  },
  {
    "id": "122",
    "name": "梅加斯",
    "enName": "122",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_122_01",
        "name": "机械超人表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_122_02",
        "name": "机械超人表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_122_03",
        "name": "机械超人表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_122_04",
        "name": "机械超人表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_122_05",
        "name": "机械超人表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_122_06",
        "name": "机械超人表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_122_07",
        "name": "机械超人表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_122_08",
        "name": "机械超人表情8",
        "isDefault": false,
        "animated": false
      }
    ]
  },
  {
    "id": "123",
    "name": "姬梦朝",
    "enName": "123",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_123_01",
        "name": "风水师表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_123_02",
        "name": "风水师表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_123_03",
        "name": "风水师表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_123_04",
        "name": "风水师表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_123_05",
        "name": "风水师表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_123_06",
        "name": "风水师表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_123_07",
        "name": "风水师表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_123_08",
        "name": "风水师表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_123_09",
        "name": "风水师表情9",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_123_10",
        "name": "风水师表情10（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_123_11",
        "name": "风水师表情11",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_123_12",
        "name": "风水师表情12（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_123_13",
        "name": "风水师表情13",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_123_14",
        "name": "风水师表情14",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_123_15",
        "name": "风水师表情15",
        "isDefault": false,
        "animated": false
      }
    ]
  },
  {
    "id": "124",
    "name": "照",
    "enName": "124",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_124_01",
        "name": "三神御主表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_124_02",
        "name": "三神御主表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_124_03",
        "name": "三神御主表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_124_04",
        "name": "三神御主表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_124_05",
        "name": "三神御主表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_124_06",
        "name": "三神御主表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_124_07",
        "name": "三神御主表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_124_08",
        "name": "三神御主表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_124_09",
        "name": "三神御主表情9",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_124_10",
        "name": "三神御主表情10",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_124_11",
        "name": "三神御主表情11",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_124_12",
        "name": "三神御主表情12",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_124_13",
        "name": "三神御主表情13（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_124_14",
        "name": "三神御主表情14",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_124_15",
        "name": "三神御主表情15（动态）",
        "isDefault": false,
        "animated": true
      }
    ]
  },
  {
    "id": "125",
    "name": "摩西",
    "enName": "125",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_125_01",
        "name": "枪匠表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_125_02",
        "name": "枪匠表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_125_03",
        "name": "枪匠表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_125_04",
        "name": "枪匠表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_125_05",
        "name": "枪匠表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_125_06",
        "name": "枪匠表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_125_07",
        "name": "枪匠表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_125_08",
        "name": "枪匠表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_125_09",
        "name": "枪匠表情9",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_125_10",
        "name": "枪匠表情10（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_125_11",
        "name": "枪匠表情11",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_125_12",
        "name": "枪匠表情12（动态）",
        "isDefault": false,
        "animated": true
      }
    ]
  },
  {
    "id": "126",
    "name": "真梦梓",
    "enName": "126",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_126_01",
        "name": "沼之蛟龙表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_126_02",
        "name": "沼之蛟龙表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_126_03",
        "name": "沼之蛟龙表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_126_04",
        "name": "沼之蛟龙表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_126_05",
        "name": "沼之蛟龙表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_126_06",
        "name": "沼之蛟龙表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_126_07",
        "name": "沼之蛟龙表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_126_08",
        "name": "沼之蛟龙表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_126_09",
        "name": "沼之蛟龙表情9",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_126_10",
        "name": "沼之蛟龙表情10（动态）",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_126_11",
        "name": "沼之蛟龙表情11",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_126_12",
        "name": "沼之蛟龙表情12（动态）",
        "isDefault": false,
        "animated": true
      }
    ]
  },
  {
    "id": "127",
    "name": "邦妮",
    "enName": "127",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_127_01",
        "name": "毒苹果表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_127_02",
        "name": "毒苹果表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_127_03",
        "name": "毒苹果表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_127_04",
        "name": "毒苹果表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_127_05",
        "name": "毒苹果表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_127_06",
        "name": "毒苹果表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_127_07",
        "name": "毒苹果表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_127_08",
        "name": "毒苹果表情8",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_127_09",
        "name": "毒苹果表情9",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_127_10",
        "name": "毒苹果表情10",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_127_11",
        "name": "毒苹果表情11",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_127_12",
        "name": "毒苹果表情12",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_127_13",
        "name": "毒苹果表情13",
        "isDefault": false,
        "animated": true
      },
      {
        "id": "UT_Item_Emoji_127_14",
        "name": "毒苹果表情14",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_127_15",
        "name": "毒苹果表情15",
        "isDefault": false,
        "animated": true
      }
    ]
  },
  {
    "id": "128",
    "name": "玲玲",
    "enName": "128",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_128_01",
        "name": "怪力乱神表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_128_02",
        "name": "怪力乱神表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_128_03",
        "name": "怪力乱神表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_128_04",
        "name": "怪力乱神表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_128_05",
        "name": "怪力乱神表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_128_06",
        "name": "怪力乱神表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_128_07",
        "name": "怪力乱神表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_128_08",
        "name": "怪力乱神表情8",
        "isDefault": false,
        "animated": false
      }
    ]
  },
  {
    "id": "129",
    "name": "赛克斯",
    "enName": "129",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_129_01",
        "name": "魔渊幼体表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_129_02",
        "name": "魔渊幼体表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_129_03",
        "name": "魔渊幼体表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_129_04",
        "name": "魔渊幼体表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_129_05",
        "name": "魔渊幼体表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_129_06",
        "name": "魔渊幼体表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_129_07",
        "name": "魔渊幼体表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_129_08",
        "name": "魔渊幼体表情8",
        "isDefault": false,
        "animated": false
      }
    ]
  },
  {
    "id": "130",
    "name": "苍鲤",
    "enName": "130",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_130_01",
        "name": "金鳞御使表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_130_02",
        "name": "金鳞御使表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_130_03",
        "name": "金鳞御使表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_130_04",
        "name": "金鳞御使表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_130_05",
        "name": "金鳞御使表情5",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_130_06",
        "name": "金鳞御使表情6",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_130_07",
        "name": "金鳞御使表情7",
        "isDefault": false,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_130_08",
        "name": "金鳞御使表情8",
        "isDefault": false,
        "animated": false
      }
    ]
  },
  {
    "id": "301",
    "name": "超绝最可爱天使酱",
    "enName": "301",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_301_01",
        "name": "超天酱表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_301_02",
        "name": "超天酱表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_301_03",
        "name": "超天酱表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_301_04",
        "name": "超天酱表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_301_05",
        "name": "超天酱表情5",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_301_06",
        "name": "超天酱表情6",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_301_07",
        "name": "超天酱表情7",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_301_08",
        "name": "超天酱表情8",
        "isDefault": true,
        "animated": false
      }
    ]
  },
  {
    "id": "302",
    "name": "主播女孩",
    "enName": "302",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_302_01",
        "name": "糖糖表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_302_02",
        "name": "糖糖表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_302_03",
        "name": "糖糖表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_302_04",
        "name": "糖糖表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_302_05",
        "name": "糖糖表情5",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_302_06",
        "name": "糖糖表情6",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_302_07",
        "name": "糖糖表情7",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_302_08",
        "name": "糖糖表情8",
        "isDefault": true,
        "animated": false
      }
    ]
  },
  {
    "id": "303",
    "name": "吉尔·斯汀雷",
    "enName": "303",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_303_01",
        "name": "吉尔表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_303_02",
        "name": "吉尔表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_303_03",
        "name": "吉尔表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_303_04",
        "name": "吉尔表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_303_05",
        "name": "吉尔表情5",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_303_06",
        "name": "吉尔表情6",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_303_07",
        "name": "吉尔表情7",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_303_08",
        "name": "吉尔表情8",
        "isDefault": true,
        "animated": false
      }
    ]
  },
  {
    "id": "304",
    "name": "多萝西·海兹",
    "enName": "304",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_304_01",
        "name": "多萝西表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_304_02",
        "name": "多萝西表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_304_03",
        "name": "多萝西表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_304_04",
        "name": "多萝西表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_304_05",
        "name": "多萝西表情5",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_304_06",
        "name": "多萝西表情6",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_304_07",
        "name": "多萝西表情7",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_304_08",
        "name": "多萝西表情8",
        "isDefault": true,
        "animated": false
      }
    ]
  },
  {
    "id": "305",
    "name": "远野汉娜",
    "enName": "305",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_305_01",
        "name": "汉娜表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_305_02",
        "name": "汉娜表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_305_03",
        "name": "汉娜表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_305_04",
        "name": "汉娜表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_305_05",
        "name": "汉娜表情5",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_305_06",
        "name": "汉娜表情6",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_305_07",
        "name": "汉娜表情7",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_305_08",
        "name": "汉娜表情8",
        "isDefault": true,
        "animated": false
      }
    ]
  },
  {
    "id": "306",
    "name": "橘雪莉",
    "enName": "306",
    "avatar": "",
    "emotes": [
      {
        "id": "UT_Item_Emoji_306_01",
        "name": "雪莉表情1",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_306_02",
        "name": "雪莉表情2",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_306_03",
        "name": "雪莉表情3",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_306_04",
        "name": "雪莉表情4",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_306_05",
        "name": "雪莉表情5",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_306_06",
        "name": "雪莉表情6",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_306_07",
        "name": "雪莉表情7",
        "isDefault": true,
        "animated": false
      },
      {
        "id": "UT_Item_Emoji_306_08",
        "name": "雪莉表情8",
        "isDefault": true,
        "animated": false
      }
    ]
  }
];

export const GAME_EMOTE_GROUPS: GameEmoteCharacterGroup[] = RAW_GROUPS.map((group) => ({
  id: group.id,
  name: group.name,
  enName: group.enName,
  avatar: group.avatar,
  emotes: group.emotes.map((em) => ({
    id: em.id,
    name: em.name,
    characterId: group.id,
    characterName: group.name,
    characterEnName: group.enName,
    isDefault: em.isDefault,
    animated: em.animated,
  })),
}));

export const ALL_GAME_EMOTES: GameEmoteItem[] = GAME_EMOTE_GROUPS.flatMap((g) => g.emotes);

export const ANIMATED_GAME_EMOTES: GameEmoteItem[] = ALL_GAME_EMOTES.filter((e) => e.animated);

const EMOTE_BY_ID = new Map<string, GameEmoteItem>(ALL_GAME_EMOTES.map((e) => [e.id, e]));

export const FEATURED_EMOTE_IDS: readonly string[] = ["UT_Item_Emoji_101_09", "UT_Item_Emoji_102_13", "UT_Item_Emoji_103_13", "UT_Item_Emoji_104_09", "UT_Item_Emoji_105_09", "UT_Item_Emoji_106_09", "UT_Item_Emoji_107_11", "UT_Item_Emoji_108_10", "UT_Item_Emoji_109_09", "UT_Item_Emoji_110_09", "UT_Item_Emoji_112_13", "UT_Item_Emoji_113_13"];

export const DEFAULT_REACTION_EMOTE_ID: string = FEATURED_EMOTE_IDS[0] ?? ALL_GAME_EMOTES[0]?.id ?? "UT_Item_Emoji_101_01";

export function findEmoteMeta(emoteId: string): GameEmoteItem | null {
  return EMOTE_BY_ID.get(emoteId) ?? null;
}

export function steamAnimatedEmoteUrl(emoteId: string, baseUrl: string = import.meta.env?.BASE_URL || '/'): string {
  if (!Object.prototype.hasOwnProperty.call(steamRevisions, emoteId)) return '';
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalized}catalog/${encodeURIComponent(emoteId)}.webp?v=${steamRevisions[emoteId]}`;
}

export function emoteImageUrl(emoteId: string, baseUrl?: string): string {
  const local = installedArtworkUrl(emoteId);
  if (local) return local;
  const steam = steamAnimatedEmoteUrl(emoteId, baseUrl);
  if (steam) return steam;
  const meta = EMOTE_BY_ID.get(emoteId);
  const suffix = meta?.animated ? "?v=anim2" : "";
  const path = `catalog/${encodeURIComponent(emoteId)}.webp${suffix}`;
  if (baseUrl === undefined) return assetUrl(path);
  return `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}${path}`;
}
