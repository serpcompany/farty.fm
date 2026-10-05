// swift-tools-version: 6.0
import PackageDescription

let optimizedInDebug: [SwiftSetting] = [.unsafeFlags(["-O"], .when(configuration: .debug))]

let package = Package(
    name: "RecordingAnalysisKit",
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: [
        .library(name: "RecordingAnalysisKit", targets: ["RecordingAnalysisKit"]),
        // The render checks (`evaluate.py` in Swift), for tests only: the app's unit tests
        // measure the app's own Toot files with them. The app doesn't link it.
        .library(name: "RenderChecking", targets: ["RenderChecking"]),
    ],
    targets: [
        // Optimized in debug builds too. Unoptimized, the app's Debug build took 1.5 to 3.2 s to
        // render a Toot in the simulator instead of under 0.1 s, and its unit tests took 281 s
        // to analyze the Fixture Library instead of about 3 s.
        .target(name: "RecordingAnalysisKit", swiftSettings: optimizedInDebug),
        .target(name: "RenderChecking", dependencies: ["RecordingAnalysisKit"], swiftSettings: optimizedInDebug),
        // The tests read the Fixture Library and the golden data straight from the repo
        // (paths relative to #filePath). Nothing from fixtures/ is bundled into the library.
        .testTarget(name: "RecordingAnalysisKitTests", dependencies: ["RecordingAnalysisKit", "RenderChecking"]),
    ]
)
