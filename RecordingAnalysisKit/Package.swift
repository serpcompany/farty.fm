// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "RecordingAnalysisKit",
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: [
        .library(name: "RecordingAnalysisKit", targets: ["RecordingAnalysisKit"]),
    ],
    targets: [
        .target(name: "RecordingAnalysisKit"),
        // The tests read the Fixture Library and the golden data straight from the repo
        // (paths relative to #filePath). Nothing from fixtures/ is bundled into the library.
        .testTarget(name: "RecordingAnalysisKitTests", dependencies: ["RecordingAnalysisKit"]),
    ]
)
