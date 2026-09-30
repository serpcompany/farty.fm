import XCTest

/// The Record, Review and Result error states, each simulated once.
class RecordErrorUITests: PedosUITestCase {
    func testCouldNotStartThenTryAgain() {
        let app = launch(failures: ["couldNotStart"])
        app.buttons["record-button"].tap()
        let alert = app.alerts["Couldn't start recording"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        attachScreenshot("Couldn't start recording")

        alert.buttons["Try again"].tap()
        XCTAssertTrue(app.buttons["Stop"].waitForExistence(timeout: 5), "Try again didn't record")
    }

    func testInterruptedRecordingSavesNothing() {
        let app = launch(failures: ["interrupted"])
        app.buttons["record-button"].tap()
        let alert = app.alerts["Recording stopped"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        XCTAssertTrue(alert.staticTexts["Nothing was saved."].exists)
        XCTAssertTrue(alert.buttons["Try again"].exists)
        attachScreenshot("Recording interrupted")

        alert.buttons["Cancel"].tap()
        XCTAssertEqual(app.buttons["record-button"].label, "Record")
        XCTAssertTrue(app.tabBars.buttons["Recordings"].isEnabled)
    }

    func testNothingHeardGoesBackToIdle() {
        let app = launch(failures: ["nothingHeard"])
        recordTake(in: app)
        XCTAssertTrue(app.staticTexts["Didn't catch that. Try again."].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Save"].exists, "There was something to save")
        XCTAssertEqual(app.buttons["record-button"].label, "Record")
        attachScreenshot("Nothing heard")
    }

    func testSaveFailedThenTryAgain() {
        let app = launch(failures: ["saveFailed"])
        recordTake(in: app)
        saveTake(in: app)
        XCTAssertTrue(app.staticTexts["Couldn't save this Recording"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Discard"].exists)
        attachScreenshot("Save failed")

        app.buttons["Try again"].tap()
        XCTAssertTrue(app.staticTexts["No steady note this time"].waitForExistence(timeout: 5), "Try again didn't save")
    }

    func testAnalysisFailedThenRetryFromRecordings() {
        // A 4 s simulated analysis keeps the spinner up long enough to check.
        let app = launch(start: "few", failures: ["analysisFailed"], analysisSeconds: 4)
        recordTake(in: app)
        saveTake(in: app)
        XCTAssertTrue(app.staticTexts["Saved, but we couldn't find its note"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Retry"].exists)
        attachScreenshot("Analysis failed")

        app.buttons["Done"].tap()
        XCTAssertTrue(app.navigationBars["Recordings"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["not analyzed"].exists)
        attachScreenshot("Recordings, not analyzed")

        app.buttons["Retry analyzing Recording 4"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["analyzing-4"].waitForExistence(timeout: 2), "No analyzing spinner")
        attachScreenshot("Recordings, analyzing")
        XCTAssertTrue(app.descendants(matching: .any)["analyzing-4"].waitForNonExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["not analyzed"].exists)
        XCTAssertTrue(app.buttons["Recording 4"].value.map { "\($0)".contains("noise-like") } ?? false)
    }
}

final class RecordErrorDarkUITests: RecordErrorUITests {
    override class var appearance: XCUIDevice.Appearance { .dark }
}
