/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0. See
 * LICENSES/PLAYWRIGHT-LICENSE.txt.
 */

/**
 * Adapted from pinned 26a9e47 server/callLog.ts, which the pinned dispatcher
 * applies to the raw progress log of every failed call. Each raw line nests by
 * its own leading spaces; a run of repeated lines prints once, headed by
 * `N × `.
 *
 * Deviations from the pinned file: Prettier formatting, this shortened licence
 * header, `"  " + (leadingWhitespace?.[0] ?? "")` for the pinned
 * `'  ' + leadingWhitespace?.[0] || ''` (equal, since the pattern `^\s*`
 * always matches), and no `findRepeatedSubsequencesForTest` export. The equivalence
 * claim is the parity assertion in scripts/generate-injected.mjs, which runs
 * both copies on the same logs and requires identical output.
 */
export function compressCallLog(log: string[]): string[] {
  const lines: string[] = [];

  for (const block of findRepeatedSubsequences(log)) {
    for (let i = 0; i < block.sequence.length; i++) {
      const line = block.sequence[i];
      const leadingWhitespace = line.match(/^\s*/);
      const whitespacePrefix = "  " + (leadingWhitespace?.[0] ?? "");
      const countPrefix = `${block.count} × `;
      if (block.count > 1 && i === 0)
        lines.push(whitespacePrefix + countPrefix + line.trim());
      else if (block.count > 1)
        lines.push(
          whitespacePrefix +
            " ".repeat(countPrefix.length - 2) +
            "- " +
            line.trim()
        );
      else lines.push(whitespacePrefix + "- " + line.trim());
    }
  }
  return lines;
}

function findRepeatedSubsequences(
  s: string[]
): { sequence: string[]; count: number }[] {
  const n = s.length;
  const result = [];
  let i = 0;

  const arraysEqual = (a1: string[], a2: string[]) => {
    if (a1.length !== a2.length) return false;
    for (let j = 0; j < a1.length; j++) {
      if (a1[j] !== a2[j]) return false;
    }

    return true;
  };

  while (i < n) {
    let maxRepeatCount = 1;
    let maxRepeatSubstr = [s[i]]; // Initialize with the element at index i
    let maxRepeatLength = 1;

    // Try substrings of length from 1 to the remaining length of the array
    for (let p = 1; p <= n - i; p++) {
      const substr = s.slice(i, i + p); // Extract substring as array
      let k = 1;

      // Count how many times the substring repeats consecutively
      while (
        i + p * k <= n &&
        arraysEqual(s.slice(i + p * (k - 1), i + p * k), substr)
      )
        k += 1;

      k -= 1; // Adjust k since it increments one extra time in the loop

      // Update the maximal repeating substring if necessary
      if (k > 1 && k * p > maxRepeatCount * maxRepeatLength) {
        maxRepeatCount = k;
        maxRepeatSubstr = substr;
        maxRepeatLength = p;
      }
    }

    // Record the substring and its count
    result.push({ sequence: maxRepeatSubstr, count: maxRepeatCount });
    i += maxRepeatLength * maxRepeatCount; // Move index forward
  }

  return result;
}
