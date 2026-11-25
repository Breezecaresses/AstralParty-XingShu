export const WORKSHOP_MODS_URL =
  'https://astralparty-xingshu.lanxichaxu.cn/xingshu-hub/extensions/mods';

export const WORKSHOP_PLUGIN_GUIDE_URL =
  'https://astralparty-xingshu.lanxichaxu.cn/xingshu-hub/extensions/plugin-guide';

export interface GuideFeatureCard {
  title: string;
  body: string;
}

export const GUIDE_FEATURES: GuideFeatureCard[] = [
  {
    title: '1. 自动导航与排序',
    body: '调用 RegisterPage 或 RegisterSimplePage 后，左侧栏「扩展框架」会自动生成对应页签按钮并按 order 排序。',
  },
  {
    title: '2. 皮肤同步与热重载',
    body: '使用 XingShuViewCardHelper / XingShuUIFactory 构建卡片、开关与滑动条时，会自动适配自定义毛玻璃配色与透明度。',
  },
  {
    title: '3. 持久化与辅助开关',
    body: '可通过 XingShuConfigService 统一读写模块偏好，并通过 AssistBall.RegisterAction 向悬浮球添加快捷开关。',
  },
];

export const SIMPLE_PAGE_SNIPPET = `using XingShuRuntime.UI;
using UnityEngine;
using UnityEngine.UI;

// 在你的独立 Mod / 插件初始化时注册到星枢功能中心：
XingShuCenterPluginHost.RegisterSimplePage(
    id: "com.example.my-helper",
    title: "示例助手",
    category: "外部扩展",
    subtitle: "自动融入星枢毛玻璃 v2 外观与侧边栏导航",
    order: 20,
    buildContent: (contentRoot, markDirty) =>
    {
        var card = XingShuViewCardHelper.CreateCardContainer(
            contentRoot, "Card_MyHelper", 148f, featureHeader: true);

        Text title = XingShuUIFactory.CreateText(
            card, "Title", "我的自定义优化模块", 17,
            XingShuGlassSkin.TextPrimary, TextAnchor.MiddleLeft, FontStyle.Bold);
        XingShuViewCardHelper.PlaceTopLeft(
            title.rectTransform, new Vector2(20f, -14f), new Vector2(360f, 26f));

        Toggle toggle = XingShuUIFactory.CreateToggle(
            card, "EnableToggle", "启用优化功能", true,
            enabled => {
                // 在此写入你的逻辑或保存配置
                markDirty?.Invoke();
            });
        XingShuViewCardHelper.PlaceTopRight(
            toggle.GetComponent<RectTransform>(), new Vector2(-20f, -14f), new Vector2(180f, 32f));
    },
    onSync: () =>
    {
        // 打开或刷新该页签时自动回调，保持状态同步
    });`;

export const INTERFACE_SNIPPET = `using XingShuRuntime.UI;
using UnityEngine;

public sealed class MyAdvancedPluginPage : IXingShuExternalPage
{
    public string Id => "com.example.advanced";
    public string Title => "高级战术面板";
    public string Category => "外部扩展";
    public string Subtitle => "完整生命周期控制的独立插件页面";
    public int Order => 30;

    private MyPluginView _view;

    public GameObject BuildView(Transform contentParent)
    {
        _view = new MyPluginView(contentParent);
        return _view.Root;
    }

    public void OnSync()
    {
        _view?.Sync();
    }
}

// 注册与热卸载：
var page = new MyAdvancedPluginPage();
XingShuCenterPluginHost.RegisterPage(page);
// XingShuCenterPluginHost.UnregisterPage(page.Id);`;

export const XSPKG_MANIFEST_SNIPPET = `{
  "format": "xingshu-xspkg-v1",
  "id": "author.my-optimization-mod",
  "name": "我的优化扩展包",
  "version": "1.0.0",
  "category": "optimization",
  "platforms": ["STEAM_CN", "TAPTAP", "BILIBILI", "WEGAME", "ANDROID_CN"],
  "entryAssembly": "MyPlugin.dll",
  "description": "兼容星枢功能中心毛玻璃 v2 宿主的扩展模组"
}`;
