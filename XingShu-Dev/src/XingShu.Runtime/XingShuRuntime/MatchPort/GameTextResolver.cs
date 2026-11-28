using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using GameLogic;
using Tools;
using UI;

namespace XingShuRuntime.MatchPort
{
    /// <summary>
    /// Resolves localized display names and stripped descriptions for cards, relics,
    /// events, buffs, heroes, and players directly from game StaticConfigure tables.
    /// </summary>
    internal static class GameTextResolver
    {
        private static readonly Regex UbbTagRegex = new Regex(@"\[[^\]]+\]", RegexOptions.Compiled);
        private static readonly Regex HtmlImgRegex = new Regex(@"<[^>]+>", RegexOptions.Compiled);

        internal static string StripRichTags(string text)
        {
            if (string.IsNullOrEmpty(text)) return "";
            string clean = HtmlImgRegex.Replace(text, " ");
            clean = UbbTagRegex.Replace(clean, "");
            return clean.Replace("\r", "").Replace("\n", " ").Trim();
        }

        internal static string SafeGetLocal(int id, UIStringType type)
        {
            if (id <= 0) return "";
            try
            {
                return id.GetLocal(type) ?? "";
            }
            catch
            {
                return "";
            }
        }

        internal static string GetCardName(int cardId)
        {
            if (cardId <= 0) return "未知卡牌";
            try
            {
                var cfg = cardId.GetCardConfigure();
                if (cfg != null)
                {
                    string name = StripRichTags(SafeGetLocal(cfg.NameID, UIStringType.Card));
                    if (!string.IsNullOrEmpty(name)) return name;
                }
            }
            catch { }
            return "卡牌#" + cardId;
        }

        internal static string GetRelicName(int relicId)
        {
            if (relicId <= 0) return "未知筹码";
            try
            {
                var cfg = UIHelper.GetRelicInfoConfigure(relicId);
                if (cfg != null)
                {
                    string name = StripRichTags(SafeGetLocal(cfg.NameID, UIStringType.Relic));
                    if (!string.IsNullOrEmpty(name)) return name;
                }
            }
            catch { }
            return "筹码#" + relicId;
        }

        internal static string GetEventName(int eventId)
        {
            if (eventId <= 0) return "未知事件";
            try
            {
                var cfg = eventId.GetEventConfigure();
                if (cfg != null)
                {
                    string name = StripRichTags(SafeGetLocal(cfg.NameID, UIStringType.Event));
                    if (!string.IsNullOrEmpty(name)) return name;
                }
            }
            catch { }
            return "事件#" + eventId;
        }

        internal static string GetEventDesc(int eventId)
        {
            if (eventId <= 0) return "";
            try
            {
                var cfg = eventId.GetEventConfigure();
                if (cfg != null)
                {
                    return StripRichTags(SafeGetLocal(cfg.DescId, UIStringType.Event));
                }
            }
            catch { }
            return "";
        }

        internal static string GetBuffName(int buffId)
        {
            if (buffId <= 0) return "";
            try
            {
                var cfg = buffId.GetBuffConfigure();
                if (cfg != null)
                {
                    return StripRichTags(SafeGetLocal(cfg.NameId, UIStringType.Buff));
                }
            }
            catch { }
            return "";
        }

        internal static string GetBuffIcon(int buffId)
        {
            if (buffId <= 0) return "";
            try
            {
                var cfg = buffId.GetBuffConfigure();
                return cfg != null ? (cfg.Icon ?? "") : "";
            }
            catch
            {
                return "";
            }
        }

        internal static string GetHeroName(int heroId)
        {
            if (heroId <= 0) return "未知角色";
            try
            {
                var cfg = heroId.GetCharacterConfigure();
                if (cfg != null)
                {
                    string name = StripRichTags(SafeGetLocal(cfg.NameID, UIStringType.Character));
                    if (!string.IsNullOrEmpty(name)) return name;
                }
            }
            catch { }
            return "角色#" + heroId;
        }

        internal static void ResolvePlayerLabels(long playerId, out string playerName, out string heroName)
        {
            playerName = playerId > 0 ? ("P" + playerId) : "未知玩家";
            heroName = "";
            try
            {
                if (!SimpleSingletonProvider<GameLogicManager>.hasInstance) return;
                var list = SimpleSingletonProvider<GameLogicManager>.inst.battle?.PlayerDatas;
                if (list == null) return;
                for (int i = 0; i < list.Count; i++)
                {
                    var p = list[i];
                    if (p == null || p.player == null || p.player.Id != playerId) continue;
                    string nick = p.player.GetNick();
                    if (!string.IsNullOrEmpty(nick))
                    {
                        playerName = StripRichTags(nick);
                    }
                    if (p.player.Hero != null && p.player.Hero.HeroId > 0)
                    {
                        heroName = GetHeroName(p.player.Hero.HeroId);
                    }
                    return;
                }
            }
            catch { }
        }
    }
}
