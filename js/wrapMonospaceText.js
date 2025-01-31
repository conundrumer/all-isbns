/**
 * Wraps text to fit within a fixed-width container using a monospace font
 * @param {string} text - The input text to wrap
 * @param {object} options - Configuration options
 * @param {number} options.maxWidth - Maximum width in characters
 * @param {number} options.maxLines - Maximum number of lines to return
 * @param {boolean} options.wordWrap - Whether to wrap at word boundaries
 * @param {boolean} options.hyphenate - Whether to add hyphens when breaking words (only used when wordWrap is true)
 * @param {string} options.overflow - How to handle overflow: 'ellipsis', 'hidden', or 'none'
 * @returns {object} Result containing lines array and metadata
 */
export default function wrapMonospaceText(text, options = {}) {
  const {
    maxWidth = 80,
    maxLines = Infinity,
    wordWrap = false,
    hyphenate = true,
    overflow = "ellipsis", // 'ellipsis', 'hidden', or 'none'
  } = options;

  const lines = [];

  if (wordWrap) {
    let currentLine = "";
    const words = text.split(" ");

    for (let word of words) {
      // Handle long words that need breaking
      if (word.length > maxWidth) {
        // Add current line if not empty
        if (currentLine) {
          lines.push(currentLine);
          currentLine = "";
        }

        // Break long word
        let remainingWord = word;
        while (remainingWord.length > maxWidth) {
          const breakPoint = hyphenate ? maxWidth - 1 : maxWidth;
          lines.push(
            hyphenate
              ? remainingWord.slice(0, breakPoint) + "-"
              : remainingWord.slice(0, breakPoint)
          );
          remainingWord = remainingWord.slice(breakPoint);
        }
        currentLine = remainingWord;
      } else {
        // Normal word handling
        if (currentLine.length + word.length + 1 <= maxWidth) {
          currentLine += (currentLine ? " " : "") + word;
        } else {
          lines.push(currentLine);
          currentLine = word;
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  } else {
    // Character wrap mode - break exactly at maxWidth
    for (let i = 0; i < text.length; i += maxWidth) {
      lines.push(text.slice(i, i + maxWidth));
    }
  }

  // Handle overflow
  const hasOverflow = lines.length > maxLines;
  let truncatedLines = lines.slice(0, maxLines);

  if (hasOverflow && overflow === "ellipsis" && truncatedLines.length > 0) {
    let lastLine = truncatedLines[truncatedLines.length - 1];
    if (lastLine.length > 3) {
      // Handle hyphenated line endings
      if (lastLine.endsWith("-")) {
        truncatedLines[truncatedLines.length - 1] = lastLine.slice(0, -1) + "…";
      } else {
        truncatedLines[truncatedLines.length - 1] = lastLine.slice(0, -1) + "…";
      }
    }
  }

  return {
    lines: truncatedLines,
    hasOverflow,
    totalLines: lines.length,
    maxWidth,
    maxLines,
  };
}
