import { ChatPanel } from '@/components/chat/ChatPanel';
import { SmartQuestionnaire } from '@/components/SmartQuestionnaire';
import { useChat, USE_STREAMING_PIPELINE } from '@/hooks/useChat';
import { useState, useCallback } from 'react';
import { ProjectWorkspace } from '@/components/workspace/ProjectWorkspace';
import { AnimatePresence, motion } from 'framer-motion';

const Index = () => {
  const {
    messages,
    generationState,
    projectFiles,
    currentPlan,
    activeFilePath,
    setActiveFilePath,
    sendMessage,
    retryLastGeneration,
    isGenerating,
    showQuestionnaire,
    pendingQuestions,
    proceedWithRequirements,
    skipQuestionnaire
  } = useChat();

  const [previewError, setPreviewError] = useState<string | null>(null);

  const handlePreviewError = useCallback((error: string) => {
    setPreviewError(error);
    console.error('Preview error:', error);
  }, []);

  return (
    <div className="h-screen w-screen grid grid-cols-[480px_1fr] overflow-hidden bg-background">
      {/* Chat Panel */}
      <div className="border-r border-border overflow-hidden">
        <ChatPanel
          messages={messages}
          onSendMessage={sendMessage}
          isGenerating={isGenerating}
        />
      </div>

      {/* Main Content Area (Preview + Questionnaire) */}
      <div className="min-w-0 overflow-hidden relative">
        <ProjectWorkspace
          files={projectFiles}
          generationState={generationState}
          currentPlan={currentPlan}
          activeFilePath={activeFilePath}
          onFileSelect={setActiveFilePath}
          onRetry={retryLastGeneration}
          onError={handlePreviewError}
          disableAutoBoot={USE_STREAMING_PIPELINE}
        />

        {/* Smart Questionnaire Overlay */}
        <AnimatePresence>
          {showQuestionnaire && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="absolute inset-0 z-50 flex items-center justify-center p-8 bg-black/10 backdrop-blur-sm"
            >
              <div className="w-full max-w-2xl">
                <SmartQuestionnaire
                  questions={pendingQuestions}
                  onComplete={proceedWithRequirements}
                  onSkip={skipQuestionnaire}
                  isProcessing={isGenerating}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Index;
