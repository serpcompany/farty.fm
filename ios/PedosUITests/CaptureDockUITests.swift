import XCTest

final class CaptureDockUITests: XCTestCase {
    /// Visits each dock area and opens the record sheet from it, attaching a screenshot
    /// of every area and of the record sheet.
    @MainActor
    func testRecordIsOneTapAwayFromEveryDockArea() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()

        let areas = [
            (tab: "Recordings", title: "Recordings"),
            (tab: "Create", title: "Create"),
            (tab: "Melodies", title: "Created Melodies"),
        ]

        for area in areas {
            app.tabBars.buttons[area.tab].tap()
            XCTAssertTrue(app.navigationBars[area.title].waitForExistence(timeout: 5), "\(area.title) is not showing")
            attachScreenshot(of: app, named: area.title)

            let record = app.buttons["Record"]
            XCTAssertTrue(record.isHittable, "Record is not one tap away from \(area.title)")
            record.tap()

            let recordSheet = app.navigationBars["New Recording"]
            XCTAssertTrue(recordSheet.waitForExistence(timeout: 5), "Record did not open from \(area.title)")
            if area.tab == areas.last?.tab {
                attachScreenshot(of: app, named: "New Recording")
            }
            recordSheet.buttons["Cancel"].tap()
            XCTAssertTrue(recordSheet.waitForNonExistence(timeout: 5), "The record sheet did not close")
        }
    }

    @MainActor
    private func attachScreenshot(of app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
