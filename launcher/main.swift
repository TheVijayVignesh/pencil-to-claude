// PencilRelay: tiny app wrapper that runs the Node relay as its child.
// macOS attributes the child's Accessibility/Automation use to this app,
// so you grant permission to "PencilRelay" instead of to every Node script.
import Foundation
import ApplicationServices

var childPid: Int32 = 0

let support = (CommandLine.arguments.count > 1) ? CommandLine.arguments[1]
  : NSHomeDirectory() + "/Library/Application Support/PencilToClaude"
let node = ProcessInfo.processInfo.environment["PENCIL_NODE"] ?? "/usr/local/bin/node"

// Ask macOS for Accessibility (shows the system prompt the first time).
let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
if !AXIsProcessTrustedWithOptions(opts) {
  FileHandle.standardError.write("PencilRelay: waiting for Accessibility permission (System Settings → Privacy & Security → Accessibility)\n".data(using: .utf8)!)
}

let p = Process()
p.executableURL = URL(fileURLWithPath: node)
p.arguments = [support + "/server.mjs"]
p.currentDirectoryURL = URL(fileURLWithPath: support)
for sig in [SIGTERM, SIGINT] {
  signal(sig) { _ in kill(childPid, SIGTERM); exit(0) }
}
do { try p.run() } catch {
  FileHandle.standardError.write("PencilRelay: can't start node at \(node): \(error)\n".data(using: .utf8)!)
  exit(1)
}
childPid = p.processIdentifier
p.waitUntilExit()
exit(p.terminationStatus)

