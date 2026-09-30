import XCTest
@testable import Pedos

/// SERP native app build identity: the Debug test host never shares the product's
/// identifier, and the test bundles keep their own.
/// `scripts/check-bundle-identifiers.sh` checks the Release identifier, which a
/// Debug test run can't observe.
final class BuildIdentityTests: XCTestCase {
    func testTestHostIsTheDebugBuildOfPedos() {
        XCTAssertEqual(Bundle.main.bundleURL.lastPathComponent, "Pedos.app")
        XCTAssertEqual(Bundle.main.bundleIdentifier, "com.serp.pedos.debug")
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String, "Pedos")
    }

    /// The Profile tab shows the version and build number from the app's Info.plist.
    func testAppVersionIsTheVersionAndBuildNumber() throws {
        XCTAssertEqual(Bundle.appVersion(info: ["CFBundleShortVersionString": "0.1.0", "CFBundleVersion": "1"]), "0.1.0 (1)")
        XCTAssertEqual(Bundle.appVersion(info: ["CFBundleShortVersionString": "0.1.0"]), "0.1.0")
        XCTAssertEqual(Bundle.appVersion(info: [:]), "Unknown")
        let version = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)
        let build = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String)
        XCTAssertEqual(Bundle.main.appVersion, "\(version) (\(build))")
    }

    func testUnitTestBundleHasItsOwnIdentifier() {
        XCTAssertEqual(Bundle(for: BuildIdentityTests.self).bundleIdentifier, "com.serp.pedos.tests")
    }
}
