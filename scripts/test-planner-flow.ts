export { };

const SUPABASE_URL = "https://pckwevanmccpclnljgjr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBja3dldmFubWNjcGNsbmxqZ2pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NDc1NDEsImV4cCI6MjA4NTMyMzU0MX0.SgzC1z8D8MEXbvgfighPPhfUsamaDCjPg_9BQMQ4G60";

async function testPlanner() {
    console.log("🚀 Starting Smart Planner Verification...");

    const testPrompt = "Build a modern SaaS landing page for a coffee subscription service.";
    let projectPlan: any = null;

    // 1. Test Analyze Prompt
    console.log("\n🔍 Step 1: Testing 'analyze-prompt'...");
    try {
        const analyzeRes = await fetch(`${SUPABASE_URL}/functions/v1/analyze-prompt`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prompt: testPrompt, projectId: 'test-project' }),
        });

        const analyzeData: any = await analyzeRes.json();
        console.log("Response:", JSON.stringify(analyzeData, null, 2));

        if (analyzeData.questions && analyzeData.questions.length > 0) {
            console.log(`✅ Success: Found ${analyzeData.questions.length} clarifying questions.`);
        } else {
            console.log("⚠️ Warning: No questions returned. AI might think the prompt is already clear.");
        }
    } catch (err: any) {
        console.error("❌ Step 1 Error:", err.message);
    }

    // 2. Test Project Planning
    console.log("\n📋 Step 2: Testing 'plan-project'...");
    try {
        const mockRequirements = {
            primaryGoal: "E-commerce landing page",
            targetUsers: "Coffee lovers",
            keyFeatures: ["Subscription tiers", "Brand story", "Contact form"],
            stylePreference: "Modern, warm, earthy tones",
            complexity: "simple"
        };

        const planRes = await fetch(`${SUPABASE_URL}/functions/v1/plan-project`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prompt: testPrompt, requirements: mockRequirements }),
        });

        const planData: any = await planRes.json();

        if (planData.success && planData.plan && planData.plan.files) {
            projectPlan = planData.plan;
            console.log(`✅ Success: AI designed a project with ${projectPlan.files.length} files.`);

            const shared = projectPlan.sharedProject;
            if (shared) {
                console.log("📂 Shared Project Context:");
                console.log(`   Name: ${shared.name}`);
                console.log(`   Theme: ${shared.theme.colors.primary} (Primary)`);
            }

            const invalidFile = projectPlan.files.find((f: any) => ['page', 'layout', 'view'].includes(f.type));
            console.log(invalidFile ? `❌ Found invalid file type "${invalidFile.type}"` : "✅ All file types valid");
        } else {
            console.log("❌ Failure: Project planning failed.", planData.error || "Unknown error");
            return;
        }
    } catch (err: any) {
        console.error("❌ Step 2 Error:", err.message);
        return;
    }

    // 3. Test Multi-file Generation
    console.log("\n🚀 Step 3: Testing 'generate-project-file'...");
    const generatedFiles: any[] = [];
    const filesToTest = (projectPlan.files as any[]).sort((a: any, b: any) => a.priority - b.priority).slice(0, 3);

    console.log(`Testing first ${filesToTest.length} files...`);

    for (const filePlan of filesToTest) {
        console.log(`\n📄 Generating: [${filePlan.type}] ${filePlan.path}...`);

        const contextFiles = generatedFiles.filter((f: any) => f.path.includes('shared/types.ts'));

        try {
            const genRes = await fetch(`${SUPABASE_URL}/functions/v1/generate-project-file`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt: testPrompt,
                    filePlan,
                    sharedProject: projectPlan.sharedProject,
                    contextFiles
                }),
            });

            const genData: any = await genRes.json();

            if (genData.success && genData.code) {
                console.log(`✅ Success: Generated ${genData.code.length} characters.`);
                console.log(`   Preview: ${genData.code.substring(0, 80).replace(/\n/g, ' ')}...`);

                generatedFiles.push({
                    path: filePlan.path,
                    content: genData.code
                });
            } else {
                console.log(`❌ Failure: ${filePlan.path}`, genData.error || "Unknown error");
            }
        } catch (err: any) {
            console.error(`❌ Step 3 Error on ${filePlan.path}:`, err.message);
        }
    }

    console.log("\n✨ Verification Complete!");
    console.log(`Summary: ${generatedFiles.length}/${filesToTest.length} files successfully generated.`);
}

testPlanner().catch(console.error);
