/**
 * HeadTracker - Singleton class for MediaPipe FaceMesh head tracking
 * Shared across all OffAxisWindow instances
 */

class HeadTracker {
    static instance = null;

    constructor() {
        if (HeadTracker.instance) {
            return HeadTracker.instance;
        }
        HeadTracker.instance = this;

        this.listeners = [];
        this.position = { x: 0, y: 0, z: 35 };
        this.isRunning = false;
        this.videoElement = null;
        this.faceMesh = null;
        this.camera = null;
    }

    static getInstance() {
        if (!HeadTracker.instance) {
            HeadTracker.instance = new HeadTracker();
        }
        return HeadTracker.instance;
    }

    /**
     * Subscribe to head position updates
     * @param {Function} callback - Called with {x, y, z} on each frame
     * @returns {Function} Unsubscribe function
     */
    subscribe(callback) {
        this.listeners.push(callback);
        // Immediately send current position
        callback(this.position);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    /**
     * Emit position to all listeners
     */
    emit(position) {
        this.position = position;
        this.listeners.forEach(callback => callback(position));
    }

    /**
     * Start head tracking
     */
    async start() {
        if (this.isRunning) return;

        // Create hidden video element
        this.videoElement = document.createElement('video');
        this.videoElement.setAttribute('playsinline', '');
        this.videoElement.style.display = 'none';
        document.body.appendChild(this.videoElement);

        // Wait for MediaPipe to load
        await this.waitForMediaPipe();

        this.faceMesh = new window.FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });

        this.faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.faceMesh.onResults((results) => this.onResults(results));

        this.camera = new window.Camera(this.videoElement, {
            onFrame: async () => {
                await this.faceMesh.send({ image: this.videoElement });
            },
            width: 640,
            height: 480,
            facingMode: 'user'
        });

        await this.camera.start();
        this.isRunning = true;
    }

    /**
     * Stop head tracking
     */
    stop() {
        if (this.camera) {
            this.camera.stop();
        }
        if (this.videoElement) {
            this.videoElement.remove();
        }
        this.isRunning = false;
    }

    /**
     * Wait for MediaPipe scripts to load
     */
    waitForMediaPipe() {
        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                if (window.FaceMesh && window.Camera) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 100);

            // Timeout after 10 seconds
            setTimeout(() => {
                clearInterval(checkInterval);
                reject(new Error('MediaPipe failed to load'));
            }, 10000);
        });
    }

    /**
     * Process FaceMesh results
     */
    onResults(results) {
        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const landmarks = results.multiFaceLandmarks[0];
            const nose = landmarks[168];

            if (nose) {
                // Normalize to -1 to 1 range
                const x = -(nose.x - 0.5) * 2;
                const y = -(nose.y - 0.5) * 2;

                // Estimate Z from eye distance
                const leftEye = landmarks[33];
                const rightEye = landmarks[263];
                const dx = leftEye.x - rightEye.x;
                const dy = leftEye.y - rightEye.y;
                const eyeDist = Math.sqrt(dx * dx + dy * dy);
                const z = Math.min(Math.max((0.15 / eyeDist) * 35, 10), 100);

                this.emit({ x, y, z });
            }
        }
    }
}

// Export for ES modules
export { HeadTracker };
