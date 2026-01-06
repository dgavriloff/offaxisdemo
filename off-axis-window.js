import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HeadTracker } from './head-tracker.js';

/**
 * OffAxisWindow - A reusable component for creating off-axis projection "windows"
 * Each instance creates its own Three.js scene but shares the HeadTracker
 */
class OffAxisWindow {
    /**
     * Create an off-axis window
     * @param {Object} options
     * @param {HTMLElement} options.container - Container element for the canvas
     * @param {string} options.modelUrl - URL to GLTF/GLB model (optional)
     * @param {THREE.Object3D} options.object - Direct Three.js object (optional)
     * @param {number} options.width - Window width in world units (default: 10)
     * @param {number} options.depth - Window depth in world units (default: 15)
     * @param {number} options.sensitivityX - Head tracking X sensitivity (default: 1.5)
     * @param {number} options.sensitivityY - Head tracking Y sensitivity (default: 1.2)
     * @param {number} options.baseDistance - Base camera distance (default: 35)
     * @param {string} options.gridColor - Grid color (default: '#FF4500')
     * @param {string} options.backgroundColor - Background color (default: '#050510')
     */
    constructor(options = {}) {
        this.container = options.container;
        this.modelUrl = options.modelUrl || null;
        this.customObject = options.object || null;
        this.width = options.width || 10;
        this.depth = options.depth || 15;
        this.sensitivityX = options.sensitivityX || 1.5;
        this.sensitivityY = options.sensitivityY || 1.2;
        this.baseDistance = options.baseDistance || 35;
        this.gridColor = options.gridColor || '#FF4500';
        this.backgroundColor = options.backgroundColor || '#050510';
        this.smoothing = options.smoothing || 0.15;

        // Internal state
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.object = null;
        this.eyePos = new THREE.Vector3(0, 0, this.baseDistance);
        this.targetEyePos = new THREE.Vector3(0, 0, this.baseDistance);
        this.unsubscribe = null;
        this.animationId = null;
        this.isDisposed = false;

        this.init();
    }

    init() {
        const rect = this.container.getBoundingClientRect();
        const aspect = rect.width / rect.height;
        this.height = this.width / aspect;

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.backgroundColor);
        this.scene.fog = new THREE.FogExp2(this.backgroundColor, 0.03);

        // Camera
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 500);
        this.scene.add(this.camera);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(rect.width, rect.height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.container.appendChild(this.renderer.domElement);

        // Setup scene content
        this.createBox();
        this.setupLights();

        // Load model or use custom object
        if (this.modelUrl) {
            this.loadModel(this.modelUrl);
        } else if (this.customObject) {
            this.setObject(this.customObject);
        } else {
            this.createDefaultObject();
        }

        // Subscribe to head tracker
        const tracker = HeadTracker.getInstance();
        this.unsubscribe = tracker.subscribe((pos) => this.onHeadMove(pos));

        // Handle resize
        this.resizeObserver = new ResizeObserver(() => this.onResize());
        this.resizeObserver.observe(this.container);

        // Start render loop
        this.animate();
    }

    createBox() {
        const gridGroup = new THREE.Group();
        const mainColor = new THREE.Color(this.gridColor);
        const subColor = new THREE.Color(this.gridColor).multiplyScalar(0.3);
        const divs = 10;

        const makeGrid = (w, d, rX, rY, rZ, pX, pY, pZ) => {
            const grid = new THREE.GridHelper(1, divs, mainColor, subColor);
            grid.scale.set(w, 1, d);
            if (rX) grid.rotation.x = rX;
            if (rY) grid.rotation.y = rY;
            if (rZ) grid.rotation.z = rZ;
            grid.position.set(pX, pY, pZ);
            return grid;
        };

        const w = this.width;
        const h = this.height;
        const d = this.depth;

        // Floor, Ceiling, Back, Left, Right walls
        gridGroup.add(makeGrid(w, d, 0, 0, 0, 0, -h / 2, -d / 2));
        gridGroup.add(makeGrid(w, d, 0, 0, 0, 0, h / 2, -d / 2));
        gridGroup.add(makeGrid(w, h, Math.PI / 2, 0, 0, 0, 0, -d));
        gridGroup.add(makeGrid(h, d, 0, 0, Math.PI / 2, -w / 2, 0, -d / 2));
        gridGroup.add(makeGrid(h, d, 0, 0, Math.PI / 2, w / 2, 0, -d / 2));

        this.scene.add(gridGroup);
    }

    setupLights() {
        const ambient = new THREE.AmbientLight(0xffffff, 1.2);
        this.scene.add(ambient);

        const point1 = new THREE.PointLight(0xffffff, 3, 100);
        point1.position.set(0, 0, 5);
        this.scene.add(point1);

        const point2 = new THREE.PointLight(new THREE.Color(this.gridColor), 2, 50);
        point2.position.set(2, 2, -5);
        this.scene.add(point2);
    }

    createDefaultObject() {
        const geo = new THREE.TorusKnotGeometry(1.5, 0.5, 100, 16);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x88ccff,
            metalness: 0.8,
            roughness: 0.2,
            emissive: 0x224488,
            emissiveIntensity: 0.3
        });
        this.object = new THREE.Mesh(geo, mat);
        this.object.position.z = -this.depth / 2;
        this.scene.add(this.object);
    }

    loadModel(url) {
        const loader = new GLTFLoader();
        loader.load(url, (gltf) => {
            this.setObject(gltf.scene);
        }, undefined, (err) => {
            console.error('Failed to load model:', err);
            this.createDefaultObject();
        });
    }

    setObject(obj) {
        if (this.object) {
            this.scene.remove(this.object);
        }

        this.object = obj;

        // Normalize scale
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const targetSize = Math.min(this.width, this.height) * 0.6;
        const scale = targetSize / maxDim;
        obj.scale.setScalar(scale);

        // Center
        obj.updateMatrixWorld(true);
        const newBox = new THREE.Box3().setFromObject(obj);
        const center = newBox.getCenter(new THREE.Vector3());
        obj.position.sub(center);
        obj.position.z = -this.depth / 2;

        this.scene.add(obj);
    }

    onHeadMove(pos) {
        this.targetEyePos.x = pos.x * this.width * this.sensitivityX;
        this.targetEyePos.y = pos.y * this.height * this.sensitivityY;
        this.targetEyePos.z = pos.z;
    }

    updateCamera() {
        this.eyePos.lerp(this.targetEyePos, this.smoothing);
        this.camera.position.copy(this.eyePos);
        this.camera.rotation.set(0, 0, 0);
        this.camera.updateMatrixWorld();

        // Off-axis projection
        const near = 0.1;
        const far = 500;
        const left = -this.width / 2 - this.eyePos.x;
        const right = this.width / 2 - this.eyePos.x;
        const top = this.height / 2 - this.eyePos.y;
        const bottom = -this.height / 2 - this.eyePos.y;
        const dist = Math.max(0.1, this.eyePos.z);

        const l = left * near / dist;
        const r = right * near / dist;
        const t = top * near / dist;
        const b = bottom * near / dist;

        this.camera.projectionMatrix.makePerspective(l, r, t, b, near, far);
    }

    animate() {
        if (this.isDisposed) return;

        this.animationId = requestAnimationFrame(() => this.animate());

        if (this.object) {
            this.object.rotation.y += 0.005;
        }

        this.updateCamera();
        this.renderer.render(this.scene, this.camera);
    }

    onResize() {
        const rect = this.container.getBoundingClientRect();
        const aspect = rect.width / rect.height;
        this.height = this.width / aspect;

        this.renderer.setSize(rect.width, rect.height);
        this.createBox(); // Rebuild box for new aspect
    }

    dispose() {
        this.isDisposed = true;

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }

        if (this.unsubscribe) {
            this.unsubscribe();
        }

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }

        if (this.renderer) {
            this.renderer.dispose();
            this.container.removeChild(this.renderer.domElement);
        }

        // Dispose Three.js resources
        this.scene.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        });
    }
}

export { OffAxisWindow };
