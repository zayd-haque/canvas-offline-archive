# tests/__init__.py
"""
Randomized Test Runner for Canvas Course Offline Ecosystem.
Hooks unittest.TestSuite.run to shuffle all tests dynamically across runs/iterations.
Guarantees test isolation and order-independence across the entire test suite.
"""

import os
import sys
import random
import unittest

_HOOK_INSTALLED = False


def _extract_individual_tests(suite):
    """Recursively extract all individual TestCase instances from a TestSuite hierarchy."""
    tests = []
    for item in suite:
        if isinstance(item, unittest.TestCase):
            tests.append(item)
        elif isinstance(item, unittest.TestSuite):
            tests.extend(_extract_individual_tests(item))
    return tests


def install_randomizer():
    """Installs the test randomization hook onto unittest.TestSuite.run."""
    global _HOOK_INSTALLED
    if _HOOK_INSTALLED:
        return
    _HOOK_INSTALLED = True

    orig_run = unittest.TestSuite.run

    def randomized_suite_run(self, result, debug=False):
        # Only shuffle at the top-level suite before running
        if getattr(result, "_testRunEntered", False) is False:
            all_tests = _extract_individual_tests(self)

            # Determine seed (allow override via TEST_SEED or SEED environment variable)
            env_seed = os.environ.get("TEST_SEED") or os.environ.get("SEED")
            if env_seed is not None:
                try:
                    seed = int(env_seed)
                except ValueError:
                    seed = random.randrange(1_000_000)
            else:
                seed = random.randrange(1_000_000)

            rng = random.Random(seed)
            rng.shuffle(all_tests)
            self._tests = all_tests

            if os.environ.get("TEST_VERBOSE_SEED", "0") == "1" or "-v" in sys.argv:
                sys.stderr.write(f"\n[Randomized Test Suite] Seed: {seed} ({len(all_tests)} tests randomized across iterations)\n")

        return orig_run(self, result, debug)

    unittest.TestSuite.run = randomized_suite_run


# Auto-install when package is imported
install_randomizer()
