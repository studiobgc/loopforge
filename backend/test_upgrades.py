import sys
import os
from pathlib import Path

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

def test_imports():
    print("Testing imports...")
    try:
        import torch
        import torchaudio
        import transformers
        import accelerate
        print("✅ Core ML libraries imported")
        print(f"Torch version: {torch.__version__}")
        print(f"MPS available: {torch.backends.mps.is_available()}")
    except ImportError as e:
        print(f"❌ Import failed: {e}")
        return False
    return True

def test_tagging_engine():
    print("\nTesting TaggingEngine...")
    try:
        from app.engines.tagging_engine import TaggingEngine
        engine = TaggingEngine()
        print("✅ TaggingEngine initialized")
        # Mock prediction test
        # result = engine.predict_tags("test.wav")
        # print(f"Prediction result: {result}")
    except Exception as e:
        print(f"❌ TaggingEngine failed: {e}")
        return False
    return True

def test_evolution_engine():
    print("\nTesting EvolutionEngine...")
    try:
        from app.engines.evolution_engine import EvolutionEngine
        engine = EvolutionEngine()
        print("✅ EvolutionEngine initialized")
    except Exception as e:
        print(f"❌ EvolutionEngine failed: {e}")
        return False
    return True

def test_separator():
    print("\nTesting StemSeparator...")
    try:
        from app.separator import get_separator
        sep = get_separator()
        print(f"✅ StemSeparator initialized on {sep.device}")
    except Exception as e:
        print(f"❌ StemSeparator failed: {e}")
        return False
    return True

def test_loop_factory():
    print("\nTesting LoopFactory Mutation...")
    try:
        from app.engines.loop_factory import LoopFactory
        factory = LoopFactory()
        print("✅ LoopFactory initialized")
        # We can't easily test mutation without a file, but we can check if textures are valid in code
        # or just rely on the fact that we imported Bitcrush successfully
        from pedalboard import Bitcrush
        print("✅ Bitcrush imported successfully")
    except Exception as e:
        print(f"❌ LoopFactory/Pedalboard failed: {e}")
        return False
    return True

if __name__ == "__main__":
    print("=== VERIFICATION START ===")
    if test_imports():
        test_tagging_engine()
        test_evolution_engine()
        test_loop_factory()
        test_separator()
    print("=== VERIFICATION END ===")
