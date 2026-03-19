/**
 * Lightweight canvas particle background with no external dependencies.
 */

(function () {
    const mountNode = document.getElementById('particle-canvas');
    if (!mountNode) {
        return;
    }

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
        return;
    }

    mountNode.appendChild(canvas);

    let width = 0;
    let height = 0;
    let animationFrameId = null;
    let pointerX = 0;
    let pointerY = 0;
    let pointerActive = false;
    let frameTick = 0;
    const particleCount = 96;
    const particles = [];
    const root = document.documentElement;

    function setCanvasSize() {
        const pixelRatio = Math.min(window.devicePixelRatio, 2);
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width * pixelRatio;
        canvas.height = height * pixelRatio;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.scale(pixelRatio, pixelRatio);
    }

    function createParticle() {
        return {
            x: Math.random() * width,
            y: Math.random() * height,
            radius: (Math.random() * 2.8) + 1.1,
            vx: (Math.random() - 0.5) * 0.46,
            vy: (Math.random() - 0.5) * 0.46,
            hue: Math.random() > 0.5 ? 145 : 205,
            drift: Math.random() * Math.PI * 2,
        };
    }

    function initializeParticles() {
        particles.length = 0;
        for (let index = 0; index < particleCount; index += 1) {
            particles.push(createParticle());
        }
    }

    function isDarkMode() {
        return root.dataset.theme === 'dark';
    }

    function getPalette() {
        if (isDarkMode()) {
            return {
                glowAlpha: 0.16,
                particleAlpha: 0.9,
                lineAlpha: 0.26,
                haloAlpha: 0.14,
                overlayAlpha: 0.18,
            };
        }

        return {
            glowAlpha: 0.1,
            particleAlpha: 0.72,
            lineAlpha: 0.18,
            haloAlpha: 0.1,
            overlayAlpha: 0.12,
        };
    }

    function drawBackgroundGlow(palette) {
        const primary = context.createRadialGradient(width * 0.15, height * 0.18, 0, width * 0.15, height * 0.18, width * 0.45);
        primary.addColorStop(0, `rgba(21, 147, 77, ${palette.overlayAlpha})`);
        primary.addColorStop(1, 'rgba(21, 147, 77, 0)');

        const secondary = context.createRadialGradient(width * 0.82, height * 0.2, 0, width * 0.82, height * 0.2, width * 0.4);
        secondary.addColorStop(0, `rgba(11, 97, 178, ${palette.overlayAlpha})`);
        secondary.addColorStop(1, 'rgba(11, 97, 178, 0)');

        context.fillStyle = primary;
        context.fillRect(0, 0, width, height);
        context.fillStyle = secondary;
        context.fillRect(0, 0, width, height);
    }

    function drawConnections() {
        const palette = getPalette();

        for (let index = 0; index < particles.length; index += 1) {
            for (let inner = index + 1; inner < particles.length; inner += 1) {
                const first = particles[index];
                const second = particles[inner];
                const dx = first.x - second.x;
                const dy = first.y - second.y;
                const distance = Math.sqrt((dx * dx) + (dy * dy));

                if (distance > 150) {
                    continue;
                }

                const opacity = Math.max(0.02, palette.lineAlpha - (distance / 900));
                context.beginPath();
                context.moveTo(first.x, first.y);
                context.lineTo(second.x, second.y);
                context.strokeStyle = `rgba(125, 216, 255, ${opacity})`;
                context.lineWidth = distance < 90 ? 1.2 : 0.8;
                context.stroke();
            }
        }
    }

    function animate() {
        const palette = getPalette();

        context.clearRect(0, 0, width, height);
        drawBackgroundGlow(palette);
        frameTick += 0.008;

        particles.forEach((particle) => {
            particle.drift += 0.01;
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.x += Math.sin(frameTick + particle.drift) * 0.08;
            particle.y += Math.cos(frameTick + particle.drift) * 0.08;

            if (particle.x < -30 || particle.x > width + 30) {
                particle.vx *= -1;
            }
            if (particle.y < -30 || particle.y > height + 30) {
                particle.vy *= -1;
            }

            const pointerDx = particle.x - pointerX;
            const pointerDy = particle.y - pointerY;
            const pointerDistance = Math.sqrt((pointerDx * pointerDx) + (pointerDy * pointerDy));
            const pointerInfluence = pointerActive && pointerDistance < 180
                ? (180 - pointerDistance) / 180
                : 0;

            const haloRadius = particle.radius * (3 + pointerInfluence * 2.2);
            const haloGradient = context.createRadialGradient(
                particle.x,
                particle.y,
                0,
                particle.x,
                particle.y,
                haloRadius
            );
            haloGradient.addColorStop(0, `hsla(${particle.hue}, 92%, 68%, ${palette.haloAlpha + (pointerInfluence * 0.1)})`);
            haloGradient.addColorStop(1, `hsla(${particle.hue}, 92%, 68%, 0)`);

            context.beginPath();
            context.arc(particle.x, particle.y, haloRadius, 0, Math.PI * 2);
            context.fillStyle = haloGradient;
            context.fill();

            context.beginPath();
            context.arc(particle.x, particle.y, particle.radius + (pointerInfluence * 0.8), 0, Math.PI * 2);
            context.fillStyle = `hsla(${particle.hue}, 92%, 72%, ${palette.particleAlpha})`;
            context.shadowBlur = 18 + (pointerInfluence * 10);
            context.shadowColor = `hsla(${particle.hue}, 90%, 72%, ${palette.glowAlpha + (pointerInfluence * 0.12)})`;
            context.fill();
            context.shadowBlur = 0;
        });

        drawConnections();
        animationFrameId = window.requestAnimationFrame(animate);
    }

    function handleResize() {
        setCanvasSize();
        initializeParticles();
    }

    function handlePointerMove(event) {
        pointerX = event.clientX;
        pointerY = event.clientY;
        pointerActive = true;
    }

    function handlePointerLeave() {
        pointerActive = false;
    }

    setCanvasSize();
    initializeParticles();
    animate();
    window.addEventListener('resize', handleResize);
    window.addEventListener('mousemove', handlePointerMove, { passive: true });
    window.addEventListener('mouseleave', handlePointerLeave);

    window.addEventListener('beforeunload', () => {
        if (animationFrameId) {
            window.cancelAnimationFrame(animationFrameId);
        }

        window.removeEventListener('resize', handleResize);
        window.removeEventListener('mousemove', handlePointerMove);
        window.removeEventListener('mouseleave', handlePointerLeave);
    });
}());
