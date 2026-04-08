import Foundation

public enum LiveCLIInsertionDecision: Equatable {
    case insert(textToAppend: String, committedText: String)
    case noChange(committedText: String)
}

/// Plans conservative live insertion updates for terminal targets.
///
/// The planner only commits text that is stable across two consecutive partial
/// transcripts. This avoids pushing raw low-confidence guesses directly into the
/// CLI, where later model revisions look like random pasted text.
public enum LiveCLIInsertionPlanner {
    public static func plan(
        previousCommittedText: String,
        previousObservedTranscript: String?,
        nextObservedTranscript: String
    ) -> LiveCLIInsertionDecision {
        guard !nextObservedTranscript.isEmpty else {
            return .noChange(committedText: previousCommittedText)
        }

        guard let previousObservedTranscript, !previousObservedTranscript.isEmpty else {
            return .noChange(committedText: previousCommittedText)
        }

        let stablePrefix = sharedStablePrefix(previousObservedTranscript, nextObservedTranscript)
        guard stablePrefix.count > previousCommittedText.count else {
            return .noChange(committedText: previousCommittedText)
        }

        let appendStart = stablePrefix.index(stablePrefix.startIndex, offsetBy: previousCommittedText.count)
        let textToAppend = String(stablePrefix[appendStart...])
        guard !textToAppend.isEmpty else {
            return .noChange(committedText: previousCommittedText)
        }

        return .insert(textToAppend: textToAppend, committedText: stablePrefix)
    }

    private static func sharedStablePrefix(_ lhs: String, _ rhs: String) -> String {
        let sharedPrefix = String(lhs.commonPrefix(with: rhs))
        return trimToWordBoundary(sharedPrefix)
    }

    private static func trimToWordBoundary(_ text: String) -> String {
        guard !text.isEmpty else { return "" }

        if let lastWhitespace = text.lastIndex(where: \.isWhitespace) {
            return String(text[...lastWhitespace])
        }

        return ""
    }
}
