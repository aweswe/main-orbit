import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Supabase credentials not found. Skipping auto-migrations.');
    process.exit(0);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigrations() {
    const migrationsDir = path.join(__dirname, '../supabase/migrations');

    if (!fs.existsSync(migrationsDir)) {
        console.log('ℹ️ No migrations directory found. Skipping.');
        return;
    }

    const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

    if (files.length === 0) {
        console.log('ℹ️ No sql migration files found.');
        return;
    }

    console.log(`\n🚀 Found ${files.length} migration(s). Checking state...`);

    for (const file of files) {
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');

        console.log(`▶️  Applying ${file}...`);

        // We attempt to run the SQL using Supabase RPC if available, or fall back to REST.
        // In a fully native Supabase setup, migrations should be applied via the CLI.
        // However, for Orbit's dynamic WebContainer setup we execute them via the client.

        try {
            // NOTE: supabase.rpc requires a stored procedure to execute raw SQL.
            // E.g. `create function exec_sql(sql_string text) returns void language plpgsql as $$ begin execute sql_string; end; $$;`
            // For this auto-migration to work securely, we assume the user has configured this execution layer or
            // we gracefully notify the UI that migrations need applied.

            const { data, error } = await supabase.rpc('exec_sql', { sql_string: sql });
            if (error) {
                // If the RPC doesn't exist, we log a helpful message describing how to set it up
                if (error.code === 'PGRST202') {
                    console.log(`⚠️ Auto-migrations require the 'exec_sql' RPC function on Supabase.`);
                    console.log(`   Please run the following in your Supabase SQL Editor once:`);
                    console.log(`   create function exec_sql(sql_string text) returns void language plpgsql security definer as $$ begin execute sql_string; end; $$;`);
                    break;
                } else {
                    console.error(`❌ Error migrating ${file}:`, error.message);
                }
            } else {
                console.log(`✅ Successfully applied ${file}`);
            }
        } catch (e) {
            console.error(`❌ Unexpected error applying ${file}:`, e.message);
        }
    }
}

runMigrations().catch(e => {
    console.error('Migration script failed:', e.message);
    process.exit(1);
});
