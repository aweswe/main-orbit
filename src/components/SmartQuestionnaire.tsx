import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronLeft, Check, FastForward, Info } from 'lucide-react';
// @ts-ignore: module resolution
import { Question, UserRequirements } from '@/types/pipeline';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

interface SmartQuestionnaireProps {
    questions: Question[];
    onComplete: (answers: UserRequirements) => void;
    onSkip: () => void;
    isProcessing?: boolean;
}

export const SmartQuestionnaire: React.FC<SmartQuestionnaireProps> = ({
    questions,
    onComplete,
    onSkip,
    isProcessing = false,
}) => {
    const [currentStep, setCurrentStep] = useState(0);
    const [answers, setAnswers] = useState<Record<string, any>>({});
    const [direction, setDirection] = useState(1); // 1 for next, -1 for back

    if (!questions || questions.length === 0) return null;

    const currentQuestion = questions[currentStep];
    const progress = ((currentStep + 1) / questions.length) * 100;
    const isLastQuestion = currentStep === questions.length - 1;

    const handleAnswer = (answer: any) => {
        const newAnswers = { ...answers, [currentQuestion.id]: answer };
        setAnswers(newAnswers);

        if (isLastQuestion) {
            submitRequirements(newAnswers);
        } else {
            setDirection(1);
            setCurrentStep(currentStep + 1);
        }
    };

    const submitRequirements = (finalAnswers: Record<string, any>) => {
        const requirements: UserRequirements = {
            primaryGoal: finalAnswers.app_purpose || 'General purpose application',
            targetUsers: finalAnswers.target_users || 'General users',
            keyFeatures: Array.isArray(finalAnswers.key_actions)
                ? finalAnswers.key_actions
                : [finalAnswers.key_actions || 'Basic functionality'],
            dataTypes: Array.isArray(finalAnswers.data_type)
                ? finalAnswers.data_type
                : [finalAnswers.data_type || 'General data'],
            userFlows: [],
            stylePreference: finalAnswers.visual_style || 'Modern & minimal',
            complexity: mapComplexity(finalAnswers.feature_complexity),
        };
        onComplete(requirements);
    };

    const handleBack = () => {
        if (currentStep > 0) {
            setDirection(-1);
            setCurrentStep(currentStep - 1);
        }
    };

    const handleSkipQuestion = () => {
        if (isLastQuestion) {
            onSkip();
        } else {
            setDirection(1);
            setCurrentStep(currentStep + 1);
        }
    };

    if (!currentQuestion) return null;

    return (
        <div className="max-w-xl mx-auto p-8 bg-white border border-gray-100 rounded-3xl shadow-2xl relative overflow-hidden backdrop-blur-xl bg-opacity-80">
            {/* Decorative gradient background */}
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-blue-100 rounded-full blur-3xl opacity-50 pointer-events-none" />
            <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-purple-100 rounded-full blur-3xl opacity-50 pointer-events-none" />

            {/* Header & Progress */}
            <div className="relative mb-8">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-blue-600 text-white rounded-lg shadow-lg">
                            <Info className="w-4 h-4" />
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-900 leading-tight">Project Clarification</h3>
                            <p className="text-xs text-gray-500">Helping the AI understand your vision</p>
                        </div>
                    </div>
                    <span className="text-xs font-mono font-bold bg-gray-100 px-2 py-1 rounded text-gray-600">
                        {currentStep + 1}/{questions.length}
                    </span>
                </div>
                <Progress value={progress} className="h-2 rounded-full" />
            </div>

            {/* Question Section */}
            <div className="relative min-h-[320px]">
                <AnimatePresence mode="wait" custom={direction}>
                    <motion.div
                        key={currentStep}
                        custom={direction}
                        initial={{ opacity: 0, x: direction * 50 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: direction * -50 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="w-full"
                    >
                        <h2 className="text-2xl font-black text-gray-900 mb-6 tracking-tight leading-8">
                            {currentQuestion.text}
                        </h2>

                        <div className="space-y-3">
                            {/* Single Select Layout */}
                            {currentQuestion.type === 'single_select' && (
                                <div className="grid grid-cols-1 gap-3">
                                    {currentQuestion.options?.map((option) => (
                                        <button
                                            key={option}
                                            className="group relative w-full p-4 text-left border-2 border-gray-100 rounded-2xl hover:border-blue-500 hover:bg-blue-50/50 transition-all duration-300"
                                            onClick={() => handleAnswer(option)}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="font-semibold text-gray-700 group-hover:text-blue-700">{option}</span>
                                                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transform group-hover:translate-x-1 transition-all" />
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Multi Select Layout */}
                            {currentQuestion.type === 'multi_select' && (
                                <MultiSelectOptions
                                    options={currentQuestion.options || []}
                                    selected={answers[currentQuestion.id] || []}
                                    onSelect={handleAnswer}
                                />
                            )}
                        </div>
                    </motion.div>
                </AnimatePresence>
            </div>

            {/* Footer Navigation */}
            <div className="relative mt-8 pt-6 border-t border-gray-100 flex items-center justify-between">
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-gray-400 hover:text-gray-600 font-bold"
                    onClick={handleBack}
                    disabled={currentStep === 0 || isProcessing}
                >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Back
                </Button>

                <div className="flex gap-2">
                    {!isLastQuestion && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="text-gray-500 hover:bg-gray-50 rounded-xl"
                            onClick={handleSkipQuestion}
                            disabled={isProcessing}
                        >
                            Skip
                            <FastForward className="w-3 h-3 ml-1 opacity-50" />
                        </Button>
                    )}

                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl"
                        onClick={onSkip}
                        disabled={isProcessing}
                    >
                        Cancel
                    </Button>
                </div>
            </div>
        </div>
    );
};

// Sub-component for Multi-select
const MultiSelectOptions: React.FC<{
    options: string[];
    selected: string[];
    onSelect: (selected: string[]) => void;
}> = ({ options, selected, onSelect }) => {
    const [localSelected, setLocalSelected] = useState<string[]>(selected);

    const toggleOption = (option: string) => {
        const newSelected = localSelected.includes(option)
            ? localSelected.filter((s) => s !== option)
            : [...localSelected, option];
        setLocalSelected(newSelected);
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {options.map((option) => (
                    <label
                        key={option}
                        className={`flex items-center p-4 border-2 rounded-2xl cursor-pointer transition-all duration-300 ${localSelected.includes(option)
                            ? 'border-blue-500 bg-blue-50 shadow-sm'
                            : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                            }`}
                    >
                        <div className={`w-5 h-5 rounded flex items-center justify-center transition-all ${localSelected.includes(option) ? 'bg-blue-600 border-blue-600' : 'border-2 border-gray-300'
                            }`}>
                            {localSelected.includes(option) && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className={`ml-3 font-semibold ${localSelected.includes(option) ? 'text-blue-700' : 'text-gray-600'}`}>
                            {option}
                        </span>
                        <input
                            type="checkbox"
                            className="hidden"
                            checked={localSelected.includes(option)}
                            onChange={() => toggleOption(option)}
                        />
                    </label>
                ))}
            </div>

            <Button
                className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl shadow-xl shadow-blue-500/20 transition-all uppercase tracking-wider text-xs"
                onClick={() => onSelect(localSelected)}
                disabled={localSelected.length === 0}
            >
                Continue with {localSelected.length} selected
                <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
        </div>
    );
};

// Helper to map UI string to complexity union
function mapComplexity(answer: string): 'simple' | 'moderate' | 'complex' {
    if (answer?.toLowerCase().includes('simple')) return 'simple';
    if (answer?.toLowerCase().includes('moderate')) return 'moderate';
    if (answer?.toLowerCase().includes('complex')) return 'complex';
    return 'moderate';
}
