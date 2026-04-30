import Foundation

enum BundledResourceLocator {
    private static let resourceBundleName = "VoiceToTextMac_VoiceToTextMac.bundle"

    static func url(forResource name: String, withExtension fileExtension: String) -> URL? {
        for directoryURL in candidateResourceDirectories() {
            let fileURL = directoryURL
                .appendingPathComponent(name, isDirectory: false)
                .appendingPathExtension(fileExtension)

            if FileManager.default.fileExists(atPath: fileURL.path) {
                return fileURL
            }
        }

        return nil
    }

    static func resourceBundleURL() -> URL? {
        for bundleURL in candidateResourceBundleURLs() {
            if isDirectory(bundleURL), Bundle(url: bundleURL) != nil {
                return bundleURL
            }
        }

        return nil
    }

    private static func candidateResourceDirectories() -> [URL] {
        var urls: [URL] = []

        if let overrideDirectory = environmentDirectory("SPEAKFLOW_RESOURCE_DIR") {
            urls.append(overrideDirectory)
        }

        if let bundleURL = resourceBundleURL() {
            urls.append(bundleURL)
        }

        if let resourceURL = Bundle.main.resourceURL {
            urls.append(resourceURL)
        }

        if let executableDirectoryURL = Bundle.main.executableURL?.deletingLastPathComponent() {
            urls.append(executableDirectoryURL)
        }

        let currentDirectoryURL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        urls.append(currentDirectoryURL.appendingPathComponent("Sources/VoiceToTextMac/Resources", isDirectory: true))
        urls.append(currentDirectoryURL.appendingPathComponent("apps/macos/Sources/VoiceToTextMac/Resources", isDirectory: true))

        return uniqueExistingDirectories(urls)
    }

    private static func candidateResourceBundleURLs() -> [URL] {
        var urls: [URL] = []

        if let overrideBundle = environmentDirectory("SPEAKFLOW_RESOURCE_BUNDLE") {
            urls.append(overrideBundle)
        }

        if let resourceURL = Bundle.main.resourceURL {
            urls.append(resourceURL.appendingPathComponent(resourceBundleName, isDirectory: true))
        }

        urls.append(Bundle.main.bundleURL.appendingPathComponent(resourceBundleName, isDirectory: true))

        if let executableDirectoryURL = Bundle.main.executableURL?.deletingLastPathComponent() {
            urls.append(executableDirectoryURL.appendingPathComponent(resourceBundleName, isDirectory: true))
        }

        let currentDirectoryURL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        urls.append(currentDirectoryURL.appendingPathComponent(resourceBundleName, isDirectory: true))

        return uniqueURLs(urls)
    }

    private static func environmentDirectory(_ key: String) -> URL? {
        guard let path = ProcessInfo.processInfo.environment[key], !path.isEmpty else {
            return nil
        }

        return URL(fileURLWithPath: path, isDirectory: true)
    }

    private static func uniqueExistingDirectories(_ urls: [URL]) -> [URL] {
        uniqueURLs(urls).filter(isDirectory)
    }

    private static func uniqueURLs(_ urls: [URL]) -> [URL] {
        var seenPaths = Set<String>()

        return urls.filter { url in
            let path = url.standardizedFileURL.path
            guard !seenPaths.contains(path) else {
                return false
            }

            seenPaths.insert(path)
            return true
        }
    }

    private static func isDirectory(_ url: URL) -> Bool {
        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) && isDirectory.boolValue
    }
}
