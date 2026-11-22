using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace XingShuRuntime.Core
{
    // The launcher build enables only explicitly installed first-party modules.
    // Package files select a known feature, never an assembly or executable path.
    internal static class LauncherModules
    {
        internal static bool CanLoad(string typeName)
        {
#if XINGSHU_MODULAR_LAUNCHER
            if (_optionalTypes == null) Load();
            return !_optionalTypes.Contains(typeName) || _enabledTypes.Contains(typeName);
#else
            return true;
#endif
        }

#if XINGSHU_MODULAR_LAUNCHER
        private static HashSet<string> _optionalTypes;
        private static HashSet<string> _enabledTypes;

        private static void Load()
        {
            var optional = new HashSet<string>(StringComparer.Ordinal);
            var enabled = new HashSet<string>(StringComparer.Ordinal);
#if XINGSHU_ANDROID_PREVIEW
            var gameRoot = Application.persistentDataPath;
#else
            var gameRoot = Path.GetDirectoryName(Application.dataPath);
#endif
            var directory = Path.Combine(gameRoot ?? "", "xingshu/plugins");
            foreach (string[] module in LauncherModuleCatalog.Modules)
            {
                bool active = Installed(directory, module[0]);
                for (int index = 1; index < module.Length; index++)
                {
                    optional.Add(module[index]);
                    if (active) enabled.Add(module[index]);
                }
            }
            _enabledTypes = enabled;
            _optionalTypes = optional;
        }

        private static bool Installed(string directory, string id)
        {
            try
            {
                var path = Path.Combine(directory, "xingshu.launcher." + id + ".module");
                if (!File.Exists(path)) return false;
                using (var stream = File.OpenRead(path))
                using (var reader = new StreamReader(stream))
                {
                    var buffer = new char[128];
                    int count = reader.ReadBlock(buffer, 0, buffer.Length);
                    return new string(buffer, 0, count) == "xingshu-module-v1:" + id + "\n";
                }
            }
            catch (IOException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
        }
#endif
    }
}
