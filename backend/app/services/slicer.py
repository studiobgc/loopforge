from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import Optional
import tempfile

import librosa
import soundfile as sf

from ..core.database import get_db
from ..core.models import SliceBankRecord, StemRole
from ..engines.slice_engine import SliceEngine, SliceRole, SliceBank


class SlicerService:
    def __init__(self, sr: int = 44100):
        self.sr = sr

    def create_slice_bank(
        self,
        session_id: str,
        audio_path: str,
        role: str = "unknown",
        start_time: Optional[float] = None,
        end_time: Optional[float] = None,
        bpm: Optional[float] = None,
        key: Optional[str] = None,
        persist: bool = True,
    ) -> SliceBank:
        source_path = Path(audio_path)
        if not source_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        try:
            role_enum = SliceRole(role)
        except ValueError:
            role_enum = SliceRole.UNKNOWN

        if start_time is not None and end_time is not None and end_time > start_time:
            duration = end_time - start_time

            y, sr = librosa.load(
                str(source_path),
                sr=self.sr,
                mono=False,
                offset=float(start_time),
                duration=float(duration),
            )

            if y.ndim == 1:
                y = y[None, :]

            audio_for_write = y.T

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as tmp:
                sf.write(tmp.name, audio_for_write, sr)
                bank = SliceEngine(sr=sr).create_slice_bank(
                    Path(tmp.name),
                    role=role_enum,
                    bpm=bpm,
                    key=key,
                )

            offset_samples = int(float(start_time) * bank.sample_rate)
            adjusted_slices = []
            for s in bank.slices:
                adjusted_slices.append(
                    replace(
                        s,
                        start_time=s.start_time + float(start_time),
                        end_time=s.end_time + float(start_time),
                        start_sample=s.start_sample + offset_samples,
                        end_sample=s.end_sample + offset_samples,
                        zero_crossing_start=s.zero_crossing_start + offset_samples,
                        zero_crossing_end=s.zero_crossing_end + offset_samples,
                    )
                )

            bank = replace(
                bank,
                source_path=str(source_path),
                source_filename=source_path.name,
                slices=adjusted_slices,
                total_duration=float(duration),
            )
        else:
            bank = SliceEngine(sr=self.sr).create_slice_bank(
                source_path,
                role=role_enum,
                bpm=bpm,
                key=key,
            )

        if persist:
            self._persist_slice_bank(session_id=session_id, bank=bank, role=role)

        return bank

    def _persist_slice_bank(self, session_id: str, bank: SliceBank, role: str) -> None:
        try:
            stem_role = StemRole(role)
        except ValueError:
            stem_role = StemRole.UNKNOWN

        db = get_db()
        with db.session() as session:
            record = SliceBankRecord(
                id=bank.id,
                session_id=session_id,
                source_filename=bank.source_filename,
                stem_role=stem_role,
                num_slices=len(bank.slices),
                total_duration=bank.total_duration,
                mean_energy=bank.mean_energy,
                max_energy=bank.max_energy,
                energy_variance=bank.energy_variance,
                slice_data=[s.to_dict() for s in bank.slices],
            )
            session.add(record)
            session.commit()
