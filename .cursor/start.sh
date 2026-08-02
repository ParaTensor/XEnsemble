#!/usr/bin/env bash
set -euo pipefail

sudo service postgresql start

for _ in $(seq 1 30); do
    if pg_isready -q -h 127.0.0.1 -p 5432; then
        break
    fi
    sleep 1
done

if ! pg_isready -q -h 127.0.0.1 -p 5432; then
    echo "PostgreSQL did not become ready" >&2
    exit 1
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='xensemble'" | grep -qx 1; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 \
        -c "CREATE ROLE xensemble LOGIN CREATEDB PASSWORD 'xensemble'"
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 \
    -c "ALTER ROLE xensemble LOGIN CREATEDB PASSWORD 'xensemble'"

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='xensemble'" | grep -qx 1; then
    sudo -u postgres createdb -O xensemble xensemble
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 \
    -c "ALTER DATABASE xensemble OWNER TO xensemble"

npm --prefix server run db:migrate

node --version
psql --version
rustc --version
pg_isready -h 127.0.0.1 -p 5432
