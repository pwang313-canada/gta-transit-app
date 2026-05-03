import csv
import sqlite3
import os
from datetime import datetime

# =========================
# CONFIG
# =========================
OUTPUT_DIR = "Go"
DB_FILE = os.path.join(OUTPUT_DIR, "go_transit.db")
CSV_OUTPUT_DIR = "GTFS_Export"

ROUTES_FILE = "routes.txt"
TRIPS_FILE = "trips.txt"
STOP_TIMES_FILE = "stop_times.txt"
STOPS_FILE = "stops.txt"
SHAPES_FILE = "shapes.txt"

# =========================
# UTIL - DATE FILTERING
# =========================
def get_date_prefix(value):
    """Extract YYYYMMDD from start of ID if present"""
    if not value:
        return None
    digits = ''.join(filter(str.isdigit, str(value)))
    return digits[:8] if len(digits) >= 8 else None


def is_future_or_today(date_str):
    if not date_str or len(date_str) != 8:
        return True
    try:
        d = datetime.strptime(date_str, "%Y%m%d").date()
        return d >= datetime.today().date()
    except:
        return True


# =========================
# UTIL - TIME CONVERSION
# =========================
def to_seconds(time_str):
    try:
        h, m, s = map(int, time_str.split(":"))
        return h * 3600 + m * 60 + s
    except:
        return None


def to_time_string(seconds):
    if seconds is None:
        return None
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def ensure_dir():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(CSV_OUTPUT_DIR, exist_ok=True)


# =========================
# DATABASE
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
            direction_id INTEGER CHECK(direction_id IN (0,1)),
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
            shape_pt_sequence INTEGER NOT NULL,
            shape_pt_lat REAL,
            shape_pt_lon REAL
        );

        CREATE INDEX idx_stop_times_stop ON stop_times(stop_id);
        CREATE INDEX idx_stop_times_trip ON stop_times(trip_id);
        CREATE INDEX idx_trips_route ON trips(route_id);
    """)

    conn.commit()
    return conn


# =========================
# ROUTES (FILTERED)
# =========================
def load_routes(conn):
    cur = conn.cursor()
    count = 0

    today = datetime.today().date()
    current_year = today.year

    with open(ROUTES_FILE, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)

        for row in reader:
            route_id = row.get("route_id")

            if not route_id:
                continue

            digits = ''.join(filter(str.isdigit, route_id))

            # Expect format: MMDDMMDD (8 digits)
            if len(digits) < 8:
                continue

            start_mmdd = digits[:4]
            end_mmdd = digits[4:8]

            try:
                start_date = datetime.strptime(f"{current_year}{start_mmdd}", "%Y%m%d").date()
                end_date = datetime.strptime(f"{current_year}{end_mmdd}", "%Y%m%d").date()
            except:
                continue

            # 🔥 KEY FIX: keep if END date is still valid
            if end_date < today:
                continue

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
# TRIPS (FILTERED)
# =========================
def load_trips(conn):
    cur = conn.cursor()
    count = 0
    skipped = 0

    with open(TRIPS_FILE, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)

        for row in reader:
            trip_id = row.get("trip_id")

            if not trip_id:
                skipped += 1
                continue

            date = get_date_prefix(trip_id)
            if date and not is_future_or_today(date):
                skipped += 1
                continue

            direction_id = None
            try:
                direction_id = int(row.get("direction_id"))
            except:
                pass

            try:
                cur.execute("""
                    INSERT INTO trips VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    trip_id,
                    row.get("route_id"),
                    row.get("service_id"),
                    direction_id,
                    row.get("trip_headsign"),
                    row.get("shape_id"),
                    row.get("route_variant")
                ))
                count += 1

            except:
                skipped += 1

    conn.commit()
    print(f"Trips loaded: {count}")
    print(f"Trips skipped: {skipped}")


# =========================
# STOP TIMES (FILTERED)
# =========================
def load_stop_times(conn):
    cur = conn.cursor()
    batch = []
    total = 0

    with open(STOP_TIMES_FILE, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)

        for row in reader:
            total += 1

            trip_id = row.get("trip_id")
            if not trip_id:
                continue

            date = get_date_prefix(trip_id)
            if date and not is_future_or_today(date):
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
# STOPS
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
# SHAPES
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
# MAIN
# =========================
def main():
    ensure_dir()
    conn = create_db()

    print("LOADING GTFS DATA...")

    load_routes(conn)
    load_trips(conn)
    load_stop_times(conn)
    load_stops(conn)
    load_shapes(conn)

    conn.close()
    print("DONE")


if __name__ == "__main__":
    main()