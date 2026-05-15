import csv
import sqlite3
import os
import re
import csv
from collections import defaultdict
# =========================
# CONFIG – DATE RANGE (YYYYMMDD)
# =========================
START_DATE = "20260501"   # inclusive start date
END_DATE   = "20260531"   # inclusive end date

OUTPUT_DIR = "Go"
DB_FILE = os.path.join(OUTPUT_DIR, "go_transit.db")
CSV_OUTPUT_DIR = "GTFS_Export"

ROUTES_FILE = "routes.txt"
TRIPS_FILE = "trips.txt"
STOP_TIMES_FILE = "stop_times.txt"
STOPS_FILE = "stops.txt"
SHAPES_FILE = "shapes.txt"

# =========================
# SIMPLE DATE CHECK (no datetime objects)
# =========================
def extract_date_from_trip_id(trip_id):
    """Return first part before '-' if it is exactly 8 digits, else None."""
    if not trip_id:
        return None
    parts = str(trip_id).split('-')
    if not parts:
        return None
    candidate = parts[0].strip()
    if candidate.isdigit() and len(candidate) == 8:
        return candidate
    return None

def is_date_in_range(date_str):
    """Compare as integers to avoid any string surprise."""
    if not date_str:
        return False
    try:
        date_int = int(date_str)
        start_int = int(START_DATE)
        end_int = int(END_DATE)
        return start_int <= date_int <= end_int
    except:
        return False

# =========================
# ROUTE DATE RANGE (unchanged, but optional)
# =========================
def route_overlaps_range(route_id):
    if not route_id:
        return False
    digits = ''.join(filter(str.isdigit, str(route_id)))
    if len(digits) < 8:
        return False
    start_mmdd = digits[:4]
    end_mmdd = digits[4:8]
    year = int(START_DATE[:4])  # use year from start date
    try:
        from datetime import datetime
        route_start = datetime.strptime(f"{year}{start_mmdd}", "%Y%m%d").date()
        route_end   = datetime.strptime(f"{year}{end_mmdd}", "%Y%m%d").date()
        start_date_obj = datetime.strptime(START_DATE, "%Y%m%d").date()
        end_date_obj   = datetime.strptime(END_DATE, "%Y%m%d").date()
        return route_end >= start_date_obj and route_start <= end_date_obj
    except:
        return False

# =========================
# UTIL – TIME CONVERSION
# =========================
def to_seconds(time_str):
    try:
        h, m, s = map(int, time_str.split(":"))
        return h * 3600 + m * 60 + s
    except:
        return None

def ensure_dir():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(CSV_OUTPUT_DIR, exist_ok=True)

# =========================
# DATABASE (schema unchanged)
# =========================
def create_db():
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.executescript("""
        DROP TABLE IF EXISTS routes;
        DROP TABLE IF EXISTS trips;
        DROP TABLE IF EXISTS stop_times;
        DROP TABLE IF EXISTS stops;
        DROP TABLE IF EXISTS shapes;

        CREATE TABLE routes (
            route_id TEXT,
            route_short_name TEXT,
            route_long_name TEXT,
            route_color TEXT
        );

        CREATE TABLE trips (
            trip_id TEXT,
            route_id TEXT NOT NULL,
            service_id TEXT NOT NULL,
            direction_id TEXT,
            trip_headsign TEXT,
            shape_id TEXT,
            route_variant TEXT
        );

        CREATE TABLE stops (
            stop_id TEXT,
            stop_name TEXT NOT NULL,
            wheelchair_boarding INTEGER CHECK(wheelchair_boarding IN (0,1,2)),
            stop_lat REAL,
            stop_lon REAL,
            stop_url TEXT
        );

        CREATE TABLE stop_times (
            trip_id TEXT NOT NULL,
            stop_id TEXT NOT NULL,
            stop_sequence INTEGER NOT NULL,
            arrival_time INTEGER NOT NULL,
            departure_time INTEGER NOT NULL
        );

        CREATE TABLE shapes (
            shape_id TEXT NOT NULL,
            shape_pt_lat REAL,
            shape_pt_lon REAL,
            shape_pt_sequence INTEGER NOT NULL
        );

        CREATE INDEX idx_stop_times_trip ON stop_times(trip_id);
        CREATE INDEX idx_trips_route ON trips(route_id);
        CREATE INDEX idx_stops_coords ON stops(stop_lat, stop_lon);
        CREATE INDEX idx_stop_times_stop_id ON stop_times(stop_id);
        CREATE INDEX idx_trips_route_service ON trips(route_id, service_id, direction_id);
        CREATE INDEX idx_routes_short_name ON routes(route_short_name);
        CREATE INDEX idx_stop_times_trip_stop ON stop_times(trip_id, stop_id);
    """)
    conn.commit()
    return conn

# =========================
# ROUTES (optional filtering)
# =========================
def load_routes(conn):
    cur = conn.cursor()
    count = 0
    with open(ROUTES_FILE, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            route_id = row.get("route_id")
            if not route_id:
                continue
            # Uncomment next line to filter routes by date range
            # if not route_overlaps_range(route_id): continue
            cur.execute("""
                INSERT INTO routes VALUES (?, ?, ?, ?)
            """, (
                route_id,
                row.get("route_short_name"),
                row.get("route_long_name"),
                row.get("route_color")
            ))
            count += 1
    conn.commit()
    print(f"Routes loaded: {count}")

# =========================
# TRIPS – filtered by date from trip_id (split by '-')
# =========================
DIRECTION_MAP = {
    "11": ("E", "W"), "12": ("E", "W"), "15": ("E", "W"), "16": ("E", "W"),
    "17": ("N", "S"), "18": ("E", "W"), "19": ("E", "W"), "21": ("E", "W"),
    "22": ("N", "S"), "25": ("E", "W"), "27": ("E", "W"), "29": ("E", "W"),
    "30": ("E", "W"), "31": ("E", "W"), "32": ("E", "W"), "33": ("E", "W"),
    "36": ("E", "W"), "37": ("N", "S"), "38": ("N", "S"), "40": ("E", "W"),
    "41": ("E", "W"), "47": ("E", "W"), "48": ("E", "W"), "52": ("E", "W"),
    "56": ("E", "W"), "61": ("N", "S"), "65": ("N", "S"), "67": ("N", "S"),
    "68": ("N", "S"), "70": ("N", "S"), "71": ("N", "S"), "88": ("N", "S"),
    "90": ("E", "W"), "92": ("E", "W"), "94": ("E", "W"), "96": ("E", "W"),
    "BR": ("N", "S"), "KI": ("W", "E"), "LE": ("E", "W"), "LW": ("E", "W"),
    "MI": ("E", "W"), "RH": ("N", "S"), "ST": ("N", "S"),
}



def clean_route_variant(variant):
    """Remove trailing letters from variant if it contains at least one digit.
       Example: '21A' -> '21', but 'BR' stays 'BR'."""
    if not variant:
        return variant
    # Only strip trailing letters if the string contains a digit
    if re.search(r'\d', variant) and variant[-1].isalpha():
        variant = re.sub(r'[A-Za-z]+$', '', variant)
    return variant

def load_trips(conn):
    cur = conn.cursor()
    count = 0
    skipped = 0

    # ----- Pre‑load route_short_name for each route_id -----
    cur.execute("SELECT route_id, route_short_name FROM routes")
    route_short_name_map = {row[0]: row[1] for row in cur.fetchall()}

    # Helper to detect train (two non‑digit characters)
    def is_train(route_short_name):
        return bool(re.fullmatch(r'[^0-9]{2}', route_short_name or ''))

    with open(TRIPS_FILE, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            trip_id = row.get("trip_id")
            if not trip_id:
                skipped += 1
                continue

            date_str = extract_date_from_trip_id(trip_id)
            if not date_str or not is_date_in_range(date_str):
                skipped += 1
                continue

            route_id = row.get("route_id")
            route_short_name = route_short_name_map.get(route_id, "")

            # ----- Determine route_variant -----
            raw_variant = row.get("route_variant")
            if not raw_variant:   # None or empty
                headsign = row.get("trip_headsign")
                if headsign:
                    raw_variant = headsign.split()[0]   # first word
                else:
                    raw_variant = None

            print(f"raw_variant: {raw_variant}")

            if is_train(route_short_name):
                # Train: take second part of route_id (split by '_', index 1)
                parts = route_id.split('_')
                variant = parts[1] if len(parts) > 1 else raw_variant
            else:
                # Bus: clean the variant (strip trailing letters if contains digits)
                variant = clean_route_variant(raw_variant)

            # ----- Convert direction_id using mapping -----
            raw_direction = row.get("direction_id")
            direction_id = None
            if raw_direction is not None:
                try:
                    dir_int = int(raw_direction)
                    if variant and variant in DIRECTION_MAP:
                        direction_id = DIRECTION_MAP[variant][dir_int]
                    else:
                        direction_id = str(dir_int)
                except (ValueError, TypeError):
                    direction_id = raw_direction

            # Insert row
            try:
                cur.execute("""
                    INSERT INTO trips VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    trip_id,
                    route_id,
                    row.get("service_id"),
                    direction_id,
                    row.get("trip_headsign"),
                    row.get("shape_id"),
                    raw_variant
                ))
                count += 1
            except Exception as e:
                print(f"Insert error for trip {trip_id}: {e}")
                skipped += 1

    conn.commit()
    print(f"Trips loaded (within date range): {count}")
    print(f"Trips skipped: {skipped}")

# =========================
# STOP TIMES – only for trips that were inserted
# =========================
def load_stop_times(conn):
    cur = conn.cursor()
    cur.execute("SELECT trip_id FROM trips")
    valid_trip_ids = set(row[0] for row in cur.fetchall())
    print(f"Will load stop_times for {len(valid_trip_ids)} trips")

    batch = []
    total = 0
    with open(STOP_TIMES_FILE, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            trip_id = row.get("trip_id")
            if not trip_id or trip_id not in valid_trip_ids:
                continue

            arrival = to_seconds(row.get("arrival_time"))
            departure = to_seconds(row.get("departure_time"))

            batch.append((
                trip_id,
                row.get("stop_id"),
                int(row.get("stop_sequence")),
                arrival,
                departure
            ))
            total += 1

            if len(batch) >= 10000:
                cur.executemany("""
                    INSERT INTO stop_times VALUES (?, ?, ?, ?, ?)
                """, batch)
                batch = []

    if batch:
        cur.executemany("""
            INSERT INTO stop_times VALUES (?, ?, ?, ?, ?)
        """, batch)

    conn.commit()
    print(f"Stop times loaded: {total}")

# =========================
# STOPS (all)
# =========================
def load_stops(conn):
    cur = conn.cursor()
    count = 0
    with open(STOPS_FILE, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                cur.execute("""
                    INSERT INTO stops VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    row.get("stop_id"),
                    row.get("stop_name"),
                    row.get("wheelchair_boarding"),
                    float(row.get("stop_lat")) if row.get("stop_lat") else None,
                    float(row.get("stop_lon")) if row.get("stop_lon") else None,
                    row.get("stop_url")
                ))
                count += 1
            except:
                pass
    conn.commit()
    print(f"Stops loaded: {count}")

# =========================
# SHAPES (all)
# =========================
def load_shapes(conn):
    cur = conn.cursor()
    batch = []
    seen = set()
    count = 0
    with open(SHAPES_FILE, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                key = (row["shape_id"], int(row["shape_pt_sequence"]))
                if key in seen:
                    continue
                seen.add(key)
                batch.append((
                    row["shape_id"],
                    float(row["shape_pt_lat"]),
                    float(row["shape_pt_lon"]),
                    int(row["shape_pt_sequence"])
                ))
                count += 1
            except:
                continue
    cur.executemany("""
        INSERT OR IGNORE INTO shapes VALUES (?, ?, ?, ?)
    """, batch)
    conn.commit()
    print(f"Shapes loaded: {count}")

# =========================
# STOP_ROUTES – pre‑aggregated stop‑to‑route mapping
# =========================
def create_stop_routes(conn):
    cur = conn.cursor()
    cur.execute("DROP TABLE IF EXISTS stop_routes")
    cur.execute("""
        CREATE TABLE stop_routes AS
        SELECT DISTINCT
            st.stop_id,
            st.trip_id,
            st.stop_sequence,
            t.route_id,
            r.route_short_name,
            r.route_color,
            t.route_variant
        FROM stop_times st
        JOIN trips t ON st.trip_id = t.trip_id
        JOIN routes r ON t.route_id = r.route_id
    """)
    # Add indexes for fast lookup
    cur.execute("CREATE INDEX idx_stop_routes_stop ON stop_routes(stop_id)")
    cur.execute("CREATE INDEX idx_stop_routes_route ON stop_routes(route_id)")
    conn.commit()
    cur.execute("SELECT COUNT(*) FROM stop_routes")
    count = cur.fetchone()[0]
    print(f"Stop‑routes mapping created: {count} distinct associations")
    
# =========================
# MAIN
# =========================
def main():
    ensure_dir()
    conn = create_db()
    print(f"LOADING GTFS DATA FOR DATE RANGE: {START_DATE} to {END_DATE}")
    load_routes(conn)      # optional route filtering commented
    load_trips(conn)
    load_stop_times(conn)
    load_stops(conn)
    load_shapes(conn)
    create_stop_routes(conn)   # <-- add this line
    conn.close()
    print("DONE")

if __name__ == "__main__":
    main()