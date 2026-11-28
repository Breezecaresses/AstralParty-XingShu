using XingShuRuntime.Core;
using XingShuRuntime.Utilities;
using UnityEngine;
using UnityEngine.UI;

namespace XingShuRuntime.UI
{
    /// <summary>
    /// Standalone page view for Game Insight ("游戏理解", Tab 15, module ID "megath-damage").
    /// </summary>
    internal sealed class XingShuMegathDamageView
    {
        private readonly GameObject _root;
        private Toggle _megathEnabledToggle;
        private Toggle _fannyEnabledToggle;
        private Toggle _mimiEnabledToggle;
        private Toggle _stackDamageToggle;
        private Toggle _megathLockToggle;
        private Button _sessionToggleBtn;
        private Text _sessionToggleBtnText;
        private Slider _megathScaleSlider;
        private Slider _megathXSlider;
        private Slider _megathYSlider;
        private Text _megathScaleText;
        private Text _megathXText;
        private Text _megathYText;
        private bool _suppressCallbacks;

        internal GameObject Root => _root;

        internal XingShuMegathDamageView(Transform parent)
        {
            _root = XingShuUIFactory.CreateUIObject("Page_MegathDamage", parent.gameObject);
            BuildUI();
            UpdateSync();
        }

        private void BuildUI()
        {
            XingShuViewCardHelper.CreatePageScroll(_root, "MegathDamageScrollView", out GameObject content);

            GameObject card = XingShuViewCardHelper.CreateCardContainer(content, "MegathDamageHintCard", 282f);
            Text title = XingShuUIFactory.CreateText(card, "Title", "游戏理解", 18, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            XingShuViewCardHelper.PlaceTopLeft(title.rectTransform, new Vector2(20f, -12f), new Vector2(450f, 26f));

            Text desc = XingShuUIFactory.CreateText(card, "Description",
                "整合芬妮潜能二选一透视、梅加斯技能伤害、米米收益与全角色叠加伤害计算；无有效信息时自动隐藏",
                12, XingShuUITheme.SecondaryText, TextAnchor.MiddleLeft);
            XingShuViewCardHelper.PlaceStretchTop(desc.rectTransform, 40f, 20f, 40f);

            _megathEnabledToggle = XingShuUIFactory.CreateToggle(card, "EnableMegathHint", "显示面板", MegathSkillDamageHint.IsEnabled,
                value => { if (!_suppressCallbacks) MegathSkillDamageHint.SetEnabled(value); });
            XingShuViewCardHelper.PlaceTopRight(_megathEnabledToggle.GetComponent<RectTransform>(), new Vector2(-20f, -10f), new Vector2(165f, 34f));

            _megathLockToggle = XingShuUIFactory.CreateToggle(card, "MegathLockToggle", "锁定位置（禁止拖动）", MegathSkillDamageHint.Locked,
                value => { if (!_suppressCallbacks) MegathSkillDamageHint.SetLocked(value); });
            XingShuViewCardHelper.PlaceTopLeft(_megathLockToggle.GetComponent<RectTransform>(), new Vector2(20f, -66f), new Vector2(220f, 32f));

            _sessionToggleBtn = XingShuViewCardHelper.CreateActionButton(card, "ToggleMegathSessionBtn", "隐藏本局浮窗",
                () => { MegathSkillDamageHint.ToggleSessionVisible(); UpdateSync(); }, 118f, 30f, 12);
            _sessionToggleBtnText = _sessionToggleBtn.GetComponentInChildren<Text>();
            XingShuViewCardHelper.PlaceTopRight(_sessionToggleBtn.GetComponent<RectTransform>(), new Vector2(-132f, -66f), new Vector2(118f, 30f));

            Button resetBtn = XingShuViewCardHelper.CreateActionButton(card, "ResetMegathLayout", "恢复默认",
                () => { MegathSkillDamageHint.ResetLayout(); UpdateSync(); }, 104f, 30f, 12);
            XingShuViewCardHelper.PlaceTopRight(resetBtn.GetComponent<RectTransform>(), new Vector2(-20f, -66f), new Vector2(104f, 30f));

            XingShuViewCardHelper.AddPercentSliderRow(card, "MegathScale", "显示大小（60%–180%）", 106f,
                XingShuConfigKeys.MegathDamageHintScaleMin, XingShuConfigKeys.MegathDamageHintScaleMax,
                MegathSkillDamageHint.Scale,
                v => { MegathSkillDamageHint.SetScale(Mathf.Round(v * 20f) / 20f); UpdateSync(); },
                () => _suppressCallbacks,
                out _megathScaleSlider, out _megathScaleText);

            XingShuViewCardHelper.AddPercentSliderRow(card, "MegathX", "水平位置 X（左 → 右）", 160f,
                0f, 1f, MegathSkillDamageHint.PosX,
                v => { MegathSkillDamageHint.SetPosition(v, MegathSkillDamageHint.PosY); UpdateSync(); },
                () => _suppressCallbacks,
                out _megathXSlider, out _megathXText);

            XingShuViewCardHelper.AddPercentSliderRow(card, "MegathY", "垂直位置 Y（上 → 下）", 214f,
                0f, 1f, MegathSkillDamageHint.PosY,
                v => { MegathSkillDamageHint.SetPosition(MegathSkillDamageHint.PosX, v); UpdateSync(); },
                () => _suppressCallbacks,
                out _megathYSlider, out _megathYText);

            GameObject subCard = XingShuViewCardHelper.CreateCardContainer(content, "GameInsightFeaturesCard", 156f);
            Text subTitle = XingShuUIFactory.CreateText(subCard, "SubTitle", "推演子项开关", 15, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            XingShuViewCardHelper.PlaceTopLeft(subTitle.rectTransform, new Vector2(20f, -12f), new Vector2(260f, 24f));

            _fannyEnabledToggle = XingShuUIFactory.CreateToggle(subCard, "EnableFannyReveal",
                "芬妮潜能二选一透视（队友可见选了哪项及另一项是什么）",
                MegathSkillDamageHint.FannyEnabled,
                value => { if (!_suppressCallbacks) MegathSkillDamageHint.SetFannyEnabled(value); });
            XingShuViewCardHelper.PlaceTopLeft(_fannyEnabledToggle.GetComponent<RectTransform>(), new Vector2(20f, -44f), new Vector2(520f, 30f));

            _mimiEnabledToggle = XingShuUIFactory.CreateToggle(subCard, "EnableMimiInsight",
                "米米「商品补货」预计星币与「维生素药丸」治愈层数预测",
                MegathSkillDamageHint.MimiEnabled,
                value => { if (!_suppressCallbacks) MegathSkillDamageHint.SetMimiEnabled(value); });
            XingShuViewCardHelper.PlaceTopLeft(_mimiEnabledToggle.GetComponent<RectTransform>(), new Vector2(20f, -80f), new Vector2(520f, 30f));

            _stackDamageToggle = XingShuUIFactory.CreateToggle(subCard, "EnableStackDamage",
                "全角色叠加伤害（美工刀+治愈、标靶/鹰眼/飞镖、星光与特殊筹码）",
                MegathSkillDamageHint.StackDamageEnabled,
                value => { if (!_suppressCallbacks) MegathSkillDamageHint.SetStackDamageEnabled(value); });
            XingShuViewCardHelper.PlaceTopLeft(_stackDamageToggle.GetComponent<RectTransform>(), new Vector2(20f, -116f), new Vector2(520f, 30f));

            GameObject ruleCard = XingShuViewCardHelper.CreateCardContainer(content, "MegathRuleCard", 140f);
            Text ruleTitle = XingShuUIFactory.CreateText(ruleCard, "RuleTitle", "计算与透视口径说明", 14, XingShuUITheme.PrimaryText, TextAnchor.MiddleLeft, FontStyle.Bold);
            XingShuViewCardHelper.PlaceTopLeft(ruleTitle.rectTransform, new Vector2(20f, -12f), new Vector2(240f, 22f));
            Text ruleBody = XingShuUIFactory.CreateText(ruleCard, "RuleBody",
                "• 芬妮潜能激发：读取联机动作广播中的两个候选项与选择结果，全队可实时对比已选项与未选项。\n" +
                "• 米米补货收益：按当前手牌内战斗牌统计星币（1张=1星币），持有「维生素药丸」时按获得手牌数（原手牌+1）累加治愈。\n" +
                "• 叠加伤害：自动区分「已计入面板ATK」与「攻击时实时叠加」的美工刀+治愈、鹰眼+标记、强光手电筒+星光、星币锤、电磁炮等效果。",
                12, XingShuUITheme.SecondaryText, TextAnchor.UpperLeft);
            XingShuViewCardHelper.PlaceStretchTop(ruleBody.rectTransform, 38f, 94f, 40f);
        }

        internal void UpdateSync()
        {
            float scale = MegathSkillDamageHint.Scale;
            float px = MegathSkillDamageHint.PosX;
            float py = MegathSkillDamageHint.PosY;
            bool locked = MegathSkillDamageHint.Locked;
            _suppressCallbacks = true;
            if (_megathEnabledToggle != null && _megathEnabledToggle.isOn != MegathSkillDamageHint.IsEnabled)
                _megathEnabledToggle.isOn = MegathSkillDamageHint.IsEnabled;
            if (_fannyEnabledToggle != null && _fannyEnabledToggle.isOn != MegathSkillDamageHint.FannyEnabled)
                _fannyEnabledToggle.isOn = MegathSkillDamageHint.FannyEnabled;
            if (_mimiEnabledToggle != null && _mimiEnabledToggle.isOn != MegathSkillDamageHint.MimiEnabled)
                _mimiEnabledToggle.isOn = MegathSkillDamageHint.MimiEnabled;
            if (_stackDamageToggle != null && _stackDamageToggle.isOn != MegathSkillDamageHint.StackDamageEnabled)
                _stackDamageToggle.isOn = MegathSkillDamageHint.StackDamageEnabled;
            if (_megathScaleSlider != null && Mathf.Abs(_megathScaleSlider.value - scale) > 0.005f)
                _megathScaleSlider.value = scale;
            if (_megathXSlider != null && Mathf.Abs(_megathXSlider.value - px) > 0.005f)
                _megathXSlider.value = px;
            if (_megathYSlider != null && Mathf.Abs(_megathYSlider.value - py) > 0.005f)
                _megathYSlider.value = py;
            if (_megathLockToggle != null && _megathLockToggle.isOn != locked)
                _megathLockToggle.isOn = locked;
            _suppressCallbacks = false;
            if (_megathScaleText != null) _megathScaleText.text = $"{Mathf.RoundToInt(scale * 100f)}%";
            if (_megathXText != null) _megathXText.text = $"{Mathf.RoundToInt(px * 100f)}%";
            if (_megathYText != null) _megathYText.text = $"{Mathf.RoundToInt(py * 100f)}%";
            if (_sessionToggleBtnText != null)
            {
                bool hiddenNow = !MegathSkillDamageHint.IsEnabled || MegathSkillDamageHint.IsSessionHidden;
                _sessionToggleBtnText.text = hiddenNow ? "显示本局浮窗" : "隐藏本局浮窗";
            }
        }
    }
}
