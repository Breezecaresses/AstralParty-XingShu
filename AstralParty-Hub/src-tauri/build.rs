fn main() {
    #[cfg(feature = "web-ui")]
    {
        // Embed our own updater; never run a helper discovered through PATH or a downloaded script.
        use sha2::{Digest, Sha256};
        use std::{fs, path::PathBuf, process::Command};

        let manifest_dir = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
        let root = manifest_dir.join("../../tools");
        println!("cargo:rerun-if-changed={}", root.join("HubUpdater.cs").display());
        println!("cargo:rerun-if-changed={}", root.join("update-public-cert.txt").display());
        let compiler = PathBuf::from(std::env::var_os("WINDIR").expect("Windows build required"))
            .join("Microsoft.NET/Framework64/v4.0.30319/csc.exe");
        let output_dir = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        let output = output_dir.join("XingShuUpdate.exe");
        let status = Command::new(&compiler).args(["/nologo", "/target:exe", "/optimize+", "/codepage:65001",
            "/reference:System.Web.Extensions.dll", "/reference:System.Windows.Forms.dll",
            "/reference:System.IO.Compression.dll", "/reference:System.IO.Compression.FileSystem.dll"])
            .arg(format!("/resource:{},update-cert", root.join("update-public-cert.txt").display()))
            .arg(format!("/out:{}", output.display())).arg(root.join("HubUpdater.cs"))
            .status().expect("Cannot compile bundled updater");
        assert!(status.success(), "Bundled updater did not compile");

        let component_manifest = manifest_dir.join("src/launcher_component_release.json");
        let component_source = root.join("GroupTestInstaller.cs");
        println!("cargo:rerun-if-changed={}", component_manifest.display());
        println!("cargo:rerun-if-changed={}", component_source.display());
        let digest = Sha256::digest(fs::read(&component_manifest).expect("Read desktop component manifest"));
        let identity = output_dir.join("ComponentPackageIdentity.cs");
        fs::write(&identity, format!(
            "internal static class PackageIdentity {{ internal const string ManifestSha256 = \"{digest:x}\"; }}"
        )).expect("Write desktop component manifest identity");
        let status = Command::new(compiler)
            .args(["/nologo", "/codepage:65001", "/target:winexe", "/optimize+", "/platform:anycpu", "/nowarn:0649",
                "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll", "/reference:System.Web.Extensions.dll"])
            .arg(format!("/out:{}", output_dir.join("XingShuComponentInstaller.exe").display()))
            .arg(component_source)
            .arg(identity)
            .status().expect("Cannot compile bundled desktop component installer");
        assert!(status.success(), "Bundled desktop component installer did not compile");
    }
    // Tauri tracks its config and capabilities, but Windows resources also
    // need rebuilding when the brand icon changes at the same file path.
    println!("cargo:rerun-if-changed=icons");
    #[cfg(target_os = "windows")]
    {
        println!(r#"cargo:rustc-link-arg=/manifestdependency:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"#);
    }
    #[cfg(feature = "web-ui")]
    tauri_build::build()
}
