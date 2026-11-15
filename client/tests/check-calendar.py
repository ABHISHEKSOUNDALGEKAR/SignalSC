"""Independently parse HTTP-downloaded exports; requires the external icalendar package."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from icalendar import Calendar

root = Path(sys.argv[1] if len(sys.argv) > 1 else '/private/tmp/trojan-step7-calendar')
cases = json.loads((root / 'expected.json').read_text())
for case in cases:
    raw = (root / (case['name'] + '.ics')).read_bytes()
    assert all(len(line) <= 75 for line in raw.split(b'\r\n')), case['name']
    calendar = Calendar.from_ical(raw)
    events = calendar.walk('VEVENT')
    assert len(events) == 1
    event = events[0]
    assert event.decoded('DTSTART').astimezone(timezone.utc) == datetime.fromisoformat(case['start'].replace('Z', '+00:00'))
    assert event.decoded('DTEND').astimezone(timezone.utc) == datetime.fromisoformat(case['end'].replace('Z', '+00:00'))
    assert event.decoded('DTSTART').astimezone(ZoneInfo('America/Los_Angeles')).strftime('%Y-%m-%d %H:%M:%S %z') == case['wall']
    assert str(event['SUMMARY']) == case['title']
    assert str(event['LOCATION']) == case['location']
    print(f"PASS {case['name']}: {case['wall']} | detail: {case['label']}")
print(f'PASS: {len(cases)} independently parsed calendar downloads, including escaped text and UTF-8 folding.')
