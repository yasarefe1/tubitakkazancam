import React from 'react';
import { BoundingBox } from '../types';

interface BoundingBoxLayerProps {
  boxes: BoundingBox[];
  onBoxClick?: (box: BoundingBox) => void;
}

const BoundingBoxLayer: React.FC<BoundingBoxLayerProps> = ({ boxes, onBoxClick }) => {
  if (!boxes || boxes.length === 0) return null;

  return (
    <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-30 overflow-hidden">
      {boxes.map((box, index) => {
        // Calculate dimensions based on percentage (0-100)
        const top = `${box.ymin}%`;
        const left = `${box.xmin}%`;
        const width = `${box.xmax - box.xmin}%`;
        const height = `${box.ymax - box.ymin}%`;

        return (
          <div
            key={index}
            onClick={(e) => {
              if (onBoxClick) {
                e.stopPropagation();
                onBoxClick(box);
              }
            }}
            className="absolute pointer-events-auto cursor-pointer"
            style={{
              top,
              left,
              width,
              height,
              border: '3px solid #22c55e',
              boxShadow: '0 0 20px rgba(34,197,94,0.7), inset 0 0 20px rgba(34,197,94,0.2)',
              animation: 'pulse-green 2s infinite',
              borderRadius: '4px',
              background: 'rgba(34, 197, 94, 0.1)'
            }}
            role="button"
            aria-label={`${box.label} odaklan`}
          >
            {/* Label Tag - Top left */}
            <div
              style={{
                position: 'absolute',
                top: '-28px',
                left: '-3px',
                background: '#22c55e',
                color: '#000',
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                borderRadius: '4px 4px 0 0',
                boxShadow: '0 0 10px rgba(34,197,94,0.5)',
                display: 'flex',
                gap: '8px'
              }}
            >
              <span>{box.label}</span>
              {box.confidence && (
                <span style={{ opacity: 0.8 }}>%{Math.round(box.confidence * 100)}</span>
              )}
            </div>

            {/* Scanning line animation */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '3px',
                background: 'linear-gradient(90deg, transparent, #22c55e, transparent)',
                animation: 'scan-line 2s linear infinite'
              }}
            />

            {/* Corner markers */}
            <div style={{ position: 'absolute', top: 0, left: 0, width: '15px', height: '15px', borderTop: '4px solid #22c55e', borderLeft: '4px solid #22c55e' }} />
            <div style={{ position: 'absolute', top: 0, right: 0, width: '15px', height: '15px', borderTop: '4px solid #22c55e', borderRight: '4px solid #22c55e' }} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, width: '15px', height: '15px', borderBottom: '4px solid #22c55e', borderLeft: '4px solid #22c55e' }} />
            <div style={{ position: 'absolute', bottom: 0, right: 0, width: '15px', height: '15px', borderBottom: '4px solid #22c55e', borderRight: '4px solid #22c55e' }} />

            {/* Center crosshair */}
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '20px',
              height: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <div style={{ width: '2px', height: '12px', background: '#22c55e', opacity: 0.6 }} />
              <div style={{ position: 'absolute', width: '12px', height: '2px', background: '#22c55e', opacity: 0.6 }} />
            </div>
          </div>
        );
      })}

      {/* CSS Animations */}
      <style>{`
        @keyframes pulse-green {
          0%, 100% { box-shadow: 0 0 20px rgba(34,197,94,0.7), inset 0 0 20px rgba(34,197,94,0.2); }
          50% { box-shadow: 0 0 35px rgba(34,197,94,0.9), inset 0 0 30px rgba(34,197,94,0.3); }
        }
        @keyframes scan-line {
          0% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(calc(100% + 100px)); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default BoundingBoxLayer;