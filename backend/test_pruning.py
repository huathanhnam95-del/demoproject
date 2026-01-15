
import unittest
from server import prune_syllables_to_expected

class TestPruning(unittest.TestCase):
    def test_pruning_removes_weakest(self):
        # Create 5 syllables. 
        # Syl 3 will be the "garbage" (short, quiet, unvoiced)
        syllables = [
            {'duration': 0.2, 'intensity': 80, 'avgPitch': 100, 'syllable': 1}, # Good
            {'duration': 0.3, 'intensity': 85, 'avgPitch': 120, 'syllable': 2}, # Strong
            {'duration': 0.05, 'intensity': 60, 'avgPitch': 0, 'syllable': 3},  # GARBAGE (Short, Quiet, Unvoiced)
            {'duration': 0.25, 'intensity': 75, 'avgPitch': 110, 'syllable': 4}, # Good
            {'duration': 0.15, 'intensity': 70, 'avgPitch': 105, 'syllable': 5}  # Good
        ]
        
        expected = 4
        result = prune_syllables_to_expected(syllables, expected)
        
        self.assertEqual(len(result), 4)
        
        # Check that the garbage one (originally index 2) is gone
        # The remaining ones should have intensities: 80, 85, 75, 70
        intensities = [s['intensity'] for s in result]
        self.assertNotIn(60, intensities)
        self.assertIn(80, intensities)
        self.assertIn(85, intensities)
        
        # Check re-indexing
        self.assertEqual(result[0]['syllable'], 1)
        self.assertEqual(result[1]['syllable'], 2)
        self.assertEqual(result[2]['syllable'], 3) # Was 4
        
    def test_pruning_keeps_split_parts(self):
        # Case: "ana" split into "a" (weak) and "na" (strong).
        # We need to ensure we don't accidentally remove "a" if there is NOISE elsewhere.
        
        syllables = [
            {'duration': 0.1, 'intensity': 70, 'avgPitch': 100, 'syllable': 1}, # "a" (Weak but valid)
            {'duration': 0.3, 'intensity': 85, 'avgPitch': 120, 'syllable': 2}, # "na"
            {'duration': 0.2, 'intensity': 80, 'avgPitch': 110, 'syllable': 3}, # "ny"
            {'duration': 0.2, 'intensity': 75, 'avgPitch': 105, 'syllable': 4}, # "mous"
            {'duration': 0.02, 'intensity': 50, 'avgPitch': 0, 'syllable': 5}   # NOISE (Very short)
        ]
        
        result = prune_syllables_to_expected(syllables, 4)
        self.assertEqual(len(result), 4)
        
        # Should remove the 0.02s noise, NOT the 0.1s "a"
        durations = [s['duration'] for s in result]
        self.assertNotIn(0.02, durations)
        self.assertIn(0.1, durations)

if __name__ == '__main__':
    unittest.main()
