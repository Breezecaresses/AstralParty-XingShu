package app.xingshu.installer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OfficialModulesCatalogTest {
    @Test
    fun allOfficialModulesMatchExpectedIdsAndSafeFormat() {
        assertEquals(19, OfficialModulesCatalog.ALL.size)
        val expected = listOf(
            "hand-monitor",
            "battle-stats",
            "avatar-praise",
            "quick-thanks",
            "star-coin-shop",
            "defense-hint",
            "knockback-preview",
            "monster-targeting",
            "monster-cooldown",
            "free-camera",
            "game-speed",
            "thinking-time",
            "action-guard",
            "replay-player",
            "static-portraits",
            "settlement-capture",
            "select-map-name",
            "battle-card-points",
            "custom-lobby-bg",
        )
        assertEquals(expected, OfficialModulesCatalog.ALL.map { it.id })
        assertEquals(19, OfficialModulesCatalog.ALL.map { it.id }.distinct().size)
        OfficialModulesCatalog.ALL.forEach { mod ->
            assertTrue("Unsafe id: ${mod.id}", OfficialModulesCatalog.isSafeId(mod.id))
            assertTrue(mod.name.isNotBlank())
            assertTrue(mod.description.isNotBlank())
            assertTrue(OfficialModulesCatalog.GROUPS.contains(mod.group))
        }
    }

    @Test
    fun csvSerializerDeduplicatesAndRejectsTraversal() {
        val fullCsv = OfficialModulesCatalog.allIdsCsv()
        assertEquals(19, fullCsv.split(",").size)
        assertEquals(
            "hand-monitor,game-speed",
            OfficialModulesCatalog.toSafeCsv(listOf(" hand-monitor ", "../evil", "HAND-MONITOR", "game-speed")),
        )
        assertFalse(OfficialModulesCatalog.isSafeId("../bad"))
        assertFalse(OfficialModulesCatalog.isSafeId("a"))
    }
}
