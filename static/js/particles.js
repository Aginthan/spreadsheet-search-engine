/**
 * Lightweight particle background powered by Three.js.
 */

(function () {
    const mountNode = document.getElementById('particle-canvas');
    if (!mountNode || !window.THREE) {
        return;
    }

    const { PerspectiveCamera, Scene, WebGLRenderer, BufferGeometry, Float32BufferAttribute, Points, PointsMaterial } = window.THREE;

    const scene = new Scene();
    const camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 42;

    const renderer = new WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    mountNode.appendChild(renderer.domElement);

    const particleCount = 180;
    const positions = [];
    const velocities = [];

    for (let index = 0; index < particleCount; index += 1) {
        positions.push(
            (Math.random() - 0.5) * 80,
            (Math.random() - 0.5) * 55,
            (Math.random() - 0.5) * 24
        );

        velocities.push(
            (Math.random() - 0.5) * 0.015,
            (Math.random() - 0.5) * 0.015,
            (Math.random() - 0.5) * 0.004
        );
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));

    const material = new PointsMaterial({
        color: 0x6ad4ff,
        size: 0.22,
        transparent: true,
        opacity: 0.7,
    });

    const particles = new Points(geometry, material);
    scene.add(particles);

    let animationFrameId = null;

    function animate() {
        const attribute = geometry.attributes.position;

        for (let index = 0; index < particleCount; index += 1) {
            const base = index * 3;

            attribute.array[base] += velocities[base];
            attribute.array[base + 1] += velocities[base + 1];
            attribute.array[base + 2] += velocities[base + 2];

            if (attribute.array[base] > 40 || attribute.array[base] < -40) {
                velocities[base] *= -1;
            }
            if (attribute.array[base + 1] > 28 || attribute.array[base + 1] < -28) {
                velocities[base + 1] *= -1;
            }
            if (attribute.array[base + 2] > 12 || attribute.array[base + 2] < -12) {
                velocities[base + 2] *= -1;
            }
        }

        attribute.needsUpdate = true;
        particles.rotation.y += 0.0008;
        particles.rotation.x += 0.00025;

        renderer.render(scene, camera);
        animationFrameId = window.requestAnimationFrame(animate);
    }

    function handleResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    window.addEventListener('resize', handleResize);
    animate();

    window.addEventListener('beforeunload', () => {
        if (animationFrameId) {
            window.cancelAnimationFrame(animationFrameId);
        }
        renderer.dispose();
        geometry.dispose();
        material.dispose();
    });
}());
