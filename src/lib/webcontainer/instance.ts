import { WebContainer } from '@webcontainer/api';

let webcontainerInstance: WebContainer | undefined;
let bootPromise: Promise<WebContainer> | undefined;

/**
 * Boots the WebContainer functionality.
 * This should be called once on application startup or when the engine is first needed.
 */
export const getWebContainer = async () => {
    if (webcontainerInstance) return webcontainerInstance;

    if (!bootPromise) {
        bootPromise = WebContainer.boot().then(instance => {
            webcontainerInstance = instance;
            return instance;
        }).catch(error => {
            console.error('Failed to boot WebContainer:', error);
            bootPromise = undefined; // allow retry on failure
            throw error;
        });
    }

    return bootPromise;
};
