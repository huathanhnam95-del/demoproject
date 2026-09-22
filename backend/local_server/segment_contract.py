"""
BEL Pronounce Segment Contract v2
Sample-domain timing validation utilities for canonical audio timelines.
"""

from dataclasses import dataclass
from typing import Optional, List, Dict, Any


@dataclass(frozen=True)
class SampleSpan:
    start_sample: int
    end_sample: int

    def validate(self, sample_count: int) -> 'SampleSpan':
        if type(sample_count) is not int or sample_count <= 0:
            raise ValueError('INVALID_SAMPLE_COUNT')
        if type(self.start_sample) is not int or type(self.end_sample) is not int:
            raise ValueError('INVALID_SPAN_TYPE')
        if not 0 <= self.start_sample < self.end_sample <= sample_count:
            raise ValueError('SPAN_OUT_OF_RANGE')
        return self


@dataclass(frozen=True)
class BoundaryRange:
    lower_sample: int
    upper_sample: int

    def validate(self, sample_count: int) -> 'BoundaryRange':
        if type(sample_count) is not int or sample_count <= 0:
            raise ValueError('INVALID_SAMPLE_COUNT')
        if type(self.lower_sample) is not int or type(self.upper_sample) is not int:
            raise ValueError('INVALID_BOUNDARY_TYPE')
        if not 0 <= self.lower_sample <= self.upper_sample <= sample_count:
            raise ValueError('BOUNDARY_OUT_OF_RANGE')
        return self


def duration_ms(span: Optional[SampleSpan], sample_rate_hz: int) -> Optional[float]:
    if span is None:
        return None
    if type(sample_rate_hz) is not int or sample_rate_hz <= 0:
        raise ValueError('INVALID_SAMPLE_RATE')
    if type(span.start_sample) is not int or type(span.end_sample) is not int:
        raise ValueError('INVALID_SPAN_TYPE')
    if span.start_sample < 0 or span.end_sample <= span.start_sample:
        raise ValueError('INVALID_SPAN')
    return 1000.0 * (span.end_sample - span.start_sample) / sample_rate_hz


def validate_timing_envelope(envelope: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(envelope, dict):
        raise ValueError('ENVELOPE_MUST_BE_DICT')
    
    schema_version = envelope.get('schemaVersion')
    if schema_version != 'pronounce-timing-v2':
        raise ValueError(f'UNSUPPORTED_SCHEMA_VERSION: {schema_version}')
        
    audio = envelope.get('audio')
    if not isinstance(audio, dict):
        raise ValueError('MISSING_AUDIO_METADATA')
        
    sample_rate = audio.get('sampleRateHz')
    sample_count = audio.get('sampleCount')
    if type(sample_rate) is not int or sample_rate <= 0:
        raise ValueError('INVALID_AUDIO_SAMPLE_RATE')
    if type(sample_count) is not int or sample_count <= 0:
        raise ValueError('INVALID_AUDIO_SAMPLE_COUNT')
        
    syllables = envelope.get('syllables', [])
    if not isinstance(syllables, list):
        raise ValueError('SYLLABLES_MUST_BE_LIST')
        
    last_end = 0
    for i, syl in enumerate(syllables):
        syl_span_data = syl.get('syllableSpan')
        if syl_span_data:
            span = SampleSpan(syl_span_data.get('startSample'), syl_span_data.get('endSample'))
            span.validate(sample_count)
            if span.start_sample < last_end:
                raise ValueError(f'OVERLAPPING_SYLLABLE_SPAN at index {i}')
            last_end = span.end_sample
            
        nuc_span_data = syl.get('nucleusSpan')
        if nuc_span_data:
            nuc_span = SampleSpan(nuc_span_data.get('startSample'), nuc_span_data.get('endSample'))
            nuc_span.validate(sample_count)
            if syl_span_data and not (syl_span_data['startSample'] <= nuc_span.start_sample < nuc_span.end_sample <= syl_span_data['endSample']):
                raise ValueError(f'NUCLEUS_OUTSIDE_SYLLABLE at index {i}')
                
    return envelope
