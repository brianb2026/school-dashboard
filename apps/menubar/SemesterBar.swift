// Semester in the Mac menu bar: your next deadline at a glance, and a menu
// with what's due next, today's classes, and what's new. It only ever talks
// to the dashboard running on this Mac (127.0.0.1); nothing leaves the machine.
//
// Build: npm run menubar   (compiles this file into "Semester Bar.app")

import AppKit

struct Summary: Decodable {
    struct Item: Decodable { let title: String; let course: String; let when: String; let left: String; let exam: Bool }
    struct ClassToday: Decodable { let course: String; let time: String; let room: String }
    let title: String
    let upcoming: [Item]
    let classes: [ClassToday]
    let changes: Int
    let holds: Int
    let name: String?
}

final class Bar: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private var timer: Timer?
    private var last: Summary?
    private var offline = false
    /// Running, but an older version without this summary: it needs a restart.
    private var outdated = false

    /// The dashboard's address; `SEMESTER_PORT` changes the port.
    private let base: URL = {
        let port = ProcessInfo.processInfo.environment["SEMESTER_PORT"].flatMap(Int.init) ?? 5179
        return URL(string: "http://127.0.0.1:\(port)")!
    }()

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let button = item.button {
            button.image = NSImage(systemSymbolName: "graduationcap", accessibilityDescription: "Semester")
            button.imagePosition = .imageLeading
            button.title = " …"
        }
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        refresh()
        // Every minute, and right after the Mac wakes.
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.refresh() }
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(refreshNow), name: NSWorkspace.didWakeNotification, object: nil)
    }

    @objc private func refreshNow() { refresh() }

    private func refresh() {
        var req = URLRequest(url: base.appendingPathComponent("api/menubar"))
        req.timeoutInterval = 10
        URLSession.shared.dataTask(with: req) { [weak self] data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode
            let summary = status == 200 ? data.flatMap { try? JSONDecoder().decode(Summary.self, from: $0) } : nil
            DispatchQueue.main.async {
                self?.outdated = status == 404
                self?.show(summary)
            }
        }.resume()
    }

    private func show(_ s: Summary?) {
        offline = s == nil
        if let s { last = s }
        guard let button = item.button else { return }
        if offline {
            button.title = outdated ? " Restart needed" : " Not running"
            button.toolTip = outdated ? "The dashboard is an older version. Restart it to finish updating." : "The school dashboard isn't running. Start it with npm start."
        } else if let s {
            button.title = " \(s.title)"
            button.toolTip = s.upcoming.first.map { "Next: \($0.title) (\($0.course)), \($0.when)" } ?? "Nothing due soon"
        }
    }

    // The menu is built fresh each time it opens, from the latest summary.
    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        if outdated {
            menu.addItem(disabled("The dashboard is running an older version."))
            menu.addItem(disabled("Restart it: Ctrl-C in its Terminal, then npm start."))
        } else if offline || last == nil {
            menu.addItem(disabled("The dashboard isn't running."))
            menu.addItem(disabled("Start it with npm start (or start.command)."))
        }
        if let s = last, !offline {
            if s.holds > 0 { menu.addItem(disabled("⚠︎ \(s.holds) hold\(s.holds == 1 ? "" : "s") on your record")) }
            if s.changes > 0 { menu.addItem(action("\(s.changes) new change\(s.changes == 1 ? "" : "s") — see what changed", #selector(open))) }
            if s.holds > 0 || s.changes > 0 { menu.addItem(.separator()) }

            menu.addItem(header("Up next"))
            if s.upcoming.isEmpty { menu.addItem(disabled("Nothing due soon")) }
            for i in s.upcoming {
                let row = action("\(i.exam ? "Exam · " : "")\(i.title)", #selector(open))
                row.attributedTitle = twoLine(i.exam ? "Exam · \(i.title)" : i.title, "\(i.course) · \(i.when) · in \(i.left)")
                menu.addItem(row)
            }
            menu.addItem(.separator())
            menu.addItem(header("Today"))
            if s.classes.isEmpty { menu.addItem(disabled("No classes today")) }
            for c in s.classes {
                menu.addItem(disabled("\(c.course)  \(c.time)\(c.room.isEmpty ? "" : "  ·  \(c.room)")"))
            }
            menu.addItem(.separator())
        }
        let openItem = action("Open dashboard", #selector(open))
        openItem.keyEquivalent = "o"
        menu.addItem(openItem)
        menu.addItem(action("Refresh", #selector(refreshNow)))
        menu.addItem(.separator())
        let quit = action("Quit Semester Bar", #selector(quit))
        quit.keyEquivalent = "q"
        menu.addItem(quit)
    }

    @objc private func open() { NSWorkspace.shared.open(base) }
    @objc private func quit() { NSApp.terminate(nil) }

    private func action(_ title: String, _ sel: Selector) -> NSMenuItem {
        let m = NSMenuItem(title: title, action: sel, keyEquivalent: "")
        m.target = self
        return m
    }
    private func disabled(_ title: String) -> NSMenuItem {
        let m = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        m.isEnabled = false
        return m
    }
    private func header(_ title: String) -> NSMenuItem {
        let m = disabled(title.uppercased())
        m.attributedTitle = NSAttributedString(string: title.uppercased(), attributes: [.font: NSFont.systemFont(ofSize: 11, weight: .semibold), .foregroundColor: NSColor.secondaryLabelColor])
        return m
    }
    private func twoLine(_ top: String, _ bottom: String) -> NSAttributedString {
        let s = NSMutableAttributedString(string: top, attributes: [.font: NSFont.menuFont(ofSize: 13)])
        s.append(NSAttributedString(string: "\n\(bottom)", attributes: [.font: NSFont.systemFont(ofSize: 11), .foregroundColor: NSColor.secondaryLabelColor]))
        return s
    }
}

let app = NSApplication.shared
let delegate = Bar()
app.delegate = delegate
app.setActivationPolicy(.accessory) // menu bar only, no Dock icon
app.run()
