import Foundation

/// Cleans raw transcripts according to the active dictation mode.
///
/// - `Terminal` mode: preserves intent closely with minimal smoothing,
///   safe for CLI prompts and AI tool inputs.
/// - `Writing` mode: cleans punctuation, removes filler words,
///   and makes prose more readable.
public struct TranscriptCleaner: Sendable {
    private static let hallucinationBlocklist: Set<String> = [
        "askforfollowupchange",
        "askforfollowupchanges",
        "thanksforwatching",
        "pleasesubscribe",
    ]
    private static let hallucinationPatterns: [String] = [
        "\\bask\\s+for\\s+follow(?:\\s|-|\\x{2010}|\\x{2011}|\\x{2012}|\\x{2013}|\\x{2014}|\\x{2212})*up\\s+change(?:s)?\\b(?:\\s*[,.;:!?]+)?",
        "\\bthanks\\s+for\\s+watching\\b(?:\\s*[,.;:!?]+)?",
        "\\bplease\\s+subscribe\\b(?:\\s*[,.;:!?]+)?",
    ]
    private static let hallucinationPrefixPatterns: [String] = [
        "^\\s*ask\\s+for\\s+follow(?:\\s|-|\\x{2010}|\\x{2011}|\\x{2012}|\\x{2013}|\\x{2014}|\\x{2212})*(?:u(?:p)?)?\\s*(?:[,.;:!?]+)?\\s*$",
    ]

    public init() {}

    /// Clean a raw transcript according to the given mode.
    public func clean(_ rawText: String, mode: DictationMode) -> String {
        let stripped = suppressKnownHallucinations(in: rawText)
        let trimmed = stripped.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        guard !Self.isBlockedHallucination(trimmed) else { return "" }

        switch mode {
        case .terminal:
            return cleanForTerminal(trimmed)
        case .writing:
            return cleanForWriting(trimmed)
        }
    }

    /// Remove known ASR boilerplate hallucinations without applying mode-specific cleanup.
    public func suppressKnownHallucinations(in text: String) -> String {
        var result = text
        var didSuppressHallucination = false

        for pattern in Self.hallucinationPatterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
                continue
            }
            let range = NSRange(result.startIndex..., in: result)
            let matchCount = regex.numberOfMatches(in: result, range: range)
            guard matchCount > 0 else {
                continue
            }

            didSuppressHallucination = true
            result = regex.stringByReplacingMatches(in: result, range: range, withTemplate: "")
        }

        if Self.isBlockedHallucinationPrefix(result) {
            return ""
        }

        result = result.replacingOccurrences(
            of: "[ \t]{2,}",
            with: " ",
            options: .regularExpression
        )
        result = result.replacingOccurrences(
            of: "\\s+([,.!?;:])",
            with: "$1",
            options: .regularExpression
        )

        let trimmed = result.trimmingCharacters(in: .whitespacesAndNewlines)
        if didSuppressHallucination, !Self.containsAlphanumeric(trimmed) {
            return ""
        }

        return trimmed
    }

    /// Returns true while an unstable live partial is still only a prefix of
    /// known ASR boilerplate. Final transcripts still pass through full cleanup.
    public func isKnownHallucinationPrefix(_ text: String) -> Bool {
        let normalized = Self.normalizedHallucinationKey(text)
        guard normalized.count >= 3 else { return false }
        return Self.hallucinationBlocklist.contains { blocked in
            blocked.hasPrefix(normalized)
        }
    }

    // MARK: - Terminal Mode

    /// Terminal mode: preserve intent closely, minimal smoothing.
    /// - Collapse repeated whitespace
    /// - Strip leading/trailing whitespace per line
    /// - Remove filler words only when they start a sentence
    /// - Do NOT alter casing or punctuation aggressively
    private func cleanForTerminal(_ text: String) -> String {
        var result = text

        // Collapse horizontal whitespace only (spaces/tabs), preserve newlines
        result = collapseHorizontalWhitespace(result)

        // Remove leading filler words only (keep mid-sentence fillers
        // since they may be intentional in a CLI prompt context)
        result = removeLeadingFillers(result)

        // Trim each line
        result = result
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .joined(separator: "\n")

        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Writing Mode

    /// Writing mode: clean more aggressively for prose.
    /// - Remove filler words throughout
    /// - Fix sentence capitalization
    /// - Normalize punctuation spacing
    /// - Collapse whitespace
    private func cleanForWriting(_ text: String) -> String {
        var result = text

        // Remove filler words throughout the text
        result = removeFillerWords(result)

        // Collapse multiple spaces
        result = collapseWhitespace(result)

        // Normalize punctuation spacing (no space before period/comma/etc.)
        result = normalizePunctuation(result)

        // Capitalize first letter of each sentence
        result = capitalizeSentences(result)

        // Trim each line
        result = result
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .joined(separator: "\n")

        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Filler Words

    private static let fillerPatterns: [String] = [
        "um", "uh", "erm", "er", "ah", "hmm",
        "you know", "I mean", "like", "so",
        "basically", "actually", "literally",
        "sort of", "kind of",
    ]

    /// Remove filler words that appear at the start of the text.
    private func removeLeadingFillers(_ text: String) -> String {
        var result = text
        var changed = true

        while changed {
            changed = false
            let lower = result.lowercased()
            for filler in Self.fillerPatterns {
                if lower.hasPrefix(filler) {
                    let afterFiller = result.index(result.startIndex, offsetBy: filler.count)
                    let rest = result[afterFiller...]

                    // Only strip if followed by whitespace, comma, or end of string
                    if rest.isEmpty {
                        result = ""
                        changed = true
                        break
                    }

                    let nextChar = rest.first!
                    if nextChar == " " || nextChar == "," {
                        result = String(rest).trimmingCharacters(in: .whitespaces)
                        // Also strip a leading comma left behind
                        if result.hasPrefix(",") {
                            result = String(result.dropFirst()).trimmingCharacters(in: .whitespaces)
                        }
                        changed = true
                        break
                    }
                }
            }
        }

        return result
    }

    /// Remove filler words throughout the text (Writing mode).
    private func removeFillerWords(_ text: String) -> String {
        var result = text

        for filler in Self.fillerPatterns {
            // Match filler words at word boundaries (case-insensitive)
            // Use a simple approach: split and filter
            result = removeWordPattern(filler, from: result)
        }

        return result
    }

    /// Remove a specific word/phrase pattern from text at word boundaries.
    private func removeWordPattern(_ pattern: String, from text: String) -> String {
        // Build a regex that matches the pattern at word boundaries
        let escaped = NSRegularExpression.escapedPattern(for: pattern)
        // Match: (start or whitespace) + pattern + (comma/space/period/end)
        // Case insensitive
        guard let regex = try? NSRegularExpression(
            pattern: "(?<=^|\\s)\(escaped)(?=[\\s,.]|$)",
            options: [.caseInsensitive]
        ) else {
            return text
        }

        let range = NSRange(text.startIndex..., in: text)
        var result = regex.stringByReplacingMatches(in: text, range: range, withTemplate: "")

        // Clean up leftover double spaces and orphaned commas
        result = result.replacingOccurrences(of: " ,", with: ",")
        result = collapseWhitespace(result)

        return result
    }

    // MARK: - Punctuation

    /// Remove spaces before punctuation marks and ensure one space after.
    private func normalizePunctuation(_ text: String) -> String {
        var result = text

        // Remove space before period, comma, question mark, exclamation
        for mark in [".", ",", "?", "!", ";", ":"] {
            result = result.replacingOccurrences(of: " \(mark)", with: mark)
        }

        // Ensure single space after sentence-ending punctuation if followed by a letter
        guard let afterPunctuation = try? NSRegularExpression(
            pattern: "([.!?])([A-Za-z])",
            options: []
        ) else {
            return result
        }

        let range = NSRange(result.startIndex..., in: result)
        result = afterPunctuation.stringByReplacingMatches(
            in: result,
            range: range,
            withTemplate: "$1 $2"
        )

        return result
    }

    // MARK: - Capitalization

    /// Capitalize the first letter of each sentence.
    private func capitalizeSentences(_ text: String) -> String {
        guard !text.isEmpty else { return text }

        var result = Array(text)
        var capitalizeNext = true

        for i in result.indices {
            let char = result[i]

            if capitalizeNext && char.isLetter {
                result[i] = Character(char.uppercased())
                capitalizeNext = false
            } else if char == "." || char == "!" || char == "?" {
                capitalizeNext = true
            } else if char == "\n" {
                capitalizeNext = true
            }
        }

        return String(result)
    }

    // MARK: - Whitespace

    /// Collapse runs of horizontal whitespace (spaces/tabs) into a single space.
    /// Preserves newlines.
    private func collapseHorizontalWhitespace(_ text: String) -> String {
        text.replacingOccurrences(
            of: "[ \t]+",
            with: " ",
            options: .regularExpression
        )
    }

    /// Collapse runs of all whitespace (including newlines) into a single space.
    private func collapseWhitespace(_ text: String) -> String {
        text.replacingOccurrences(
            of: "\\s+",
            with: " ",
            options: .regularExpression
        )
    }

    private static func isBlockedHallucination(_ text: String) -> Bool {
        let normalized = normalizedHallucinationKey(text)
        return hallucinationBlocklist.contains(normalized)
    }

    private static func isBlockedHallucinationPrefix(_ text: String) -> Bool {
        for pattern in hallucinationPrefixPatterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
                continue
            }

            let range = NSRange(text.startIndex..., in: text)
            if regex.firstMatch(in: text, range: range) != nil {
                return true
            }
        }

        return false
    }

    private static func containsAlphanumeric(_ text: String) -> Bool {
        text.contains { character in
            character.isLetter || character.isNumber
        }
    }

    private static func normalizedHallucinationKey(_ text: String) -> String {
        text.lowercased().filter(\.isLetter)
    }
}
