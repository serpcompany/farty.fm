import XCTest

/// The Recordings tab: empty, and with all 23 Fixture Library Recordings.
class RecordingsUITests: PedosUITestCase {
    func testEmptyRecordings() {
        let app = launch(start: "new")
        app.tabBars.buttons["Recordings"].tap()
        XCTAssertTrue(app.staticTexts["No Recordings yet"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Go to the Record tab and tap the red button."].exists)
        attachScreenshot("Recordings, empty")
    }

    func testAllRecordingsAndPlayback() {
        let app = launch(start: "all")
        app.tabBars.buttons["Recordings"].tap()
        XCTAssertTrue(app.staticTexts["9 Melodic Recordings across 6 notes"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["23 Recordings"].exists)
        XCTAssertEqual(app.descendants(matching: .any)["pitch-strip"].label, "Notes collected: C, E, F♯, G, G♯, and B")
        attachScreenshot("Recordings, all 23")

        // Recording 17 is the longest take (2 s): tapping it plays it and highlights the row.
        let row = app.buttons["Recording 17"]
        XCTAssertTrue(row.value.map { "\($0)".contains("first fart used") } ?? false)
        row.tap()
        attachScreenshot("Recordings, playing")
        XCTAssertTrue(row.waitForValue(containing: "playing", timeout: 2), "The row isn't playing")
        XCTAssertTrue(row.waitForValue(notContaining: "playing", timeout: 5), "The row didn't stop playing at the end")
    }
}

final class RecordingsDarkUITests: RecordingsUITests {
    override class var appearance: XCUIDevice.Appearance { .dark }
}

private extension XCUIElement {
    func waitForValue(containing text: String, timeout: TimeInterval) -> Bool {
        let predicate = NSPredicate(format: "value CONTAINS %@", text)
        return XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: self)], timeout: timeout) == .completed
    }

    func waitForValue(notContaining text: String, timeout: TimeInterval) -> Bool {
        let predicate = NSPredicate(format: "NOT (value CONTAINS %@)", text)
        return XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: self)], timeout: timeout) == .completed
    }
}
