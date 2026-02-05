export type FileType =
    | 'component'  // React components (UI, features, pages, App)
    | 'hook'       // Custom React hooks
    | 'service'    // API/External services
    | 'type'       // TypeScript definitions
    | 'util'       // Helper functions
    | 'store';     // State management

export interface FilePlan {
    path: string;
    type: FileType;
    purpose: string;
    dependencies: string[]; // Absolute-ish paths (relative to src/)
    exports: string[];
    priority: number;
    estimatedLines: number;
}

export interface ProjectPlan {
    architecture: 'simple' | 'moderate' | 'complex';
    stateManagement: string;
    styling: string;
    files: FilePlan[];
    dependencies?: string[];
    thought?: string;
    sharedProject?: any; // Added to match runtime usage
}

export interface PromptAnalysis {
    isVague: boolean;
    missingInfo: string[];
    confidence: number;
    explanation: string;
}

export interface Question {
    id: string;
    text: string;
    type: 'single_select' | 'multi_select' | 'text';
    options?: string[];
}

export interface UserRequirements {
    primaryGoal: string;
    targetUsers: string;
    keyFeatures: string[];
    dataTypes: string[];
    userFlows: string[];
    stylePreference: string;
    complexity: 'simple' | 'moderate' | 'complex';
}

export interface UIUXPlan {
    palette: {
        primary: string;
        secondary: string;
        accent: string;
        background: string;
    };
    layout: string;
    typography: string;
    animations: string;
}
