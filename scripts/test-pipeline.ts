import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testPipeline() {
    console.log('--- TESTING TWO-STEP REASONING PIPELINE ---');
    console.log('Sending prompt: "Create a Next.js dashboard with MUI"');

    const { data, error } = await supabase.functions.invoke('generate-app', {
        body: {
            prompt: "Create a Next.js dashboard with MUI",
            stream: false
        },
    });

    if (error) {
        console.error('❌ Pipeline Error:', error);
        return;
    }

    console.log('✅ Pipeline Success!');
    console.log('Analysis Field Present:', !!data.analysis);
    if (data.analysis) {
        console.log('\n--- ARCHITECT ANALYSIS ---');
        console.log(data.analysis);
    } else {
        console.log('⚠️ Analysis field is missing from response!');
    }

    if (data.content) {
        console.log('\n--- GENERATED CODE (Builder) ---');
        console.log(data.content.substring(0, 1000) + '...');
    } else {
        console.log('⚠️ Content field is missing or empty!');
    }
}

testPipeline();
