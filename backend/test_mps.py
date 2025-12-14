import torch
from app.separator import get_separator

def test_mps():
    if not torch.backends.mps.is_available():
        print("MPS not available")
        return

    print("MPS available")
    sep = get_separator()
    print(f"Separator device: {sep.device}")
    
    if sep.device.type == 'mps':
        print("SUCCESS: Separator using MPS")
    else:
        print(f"FAILURE: Separator using {sep.device}")

if __name__ == "__main__":
    test_mps()
