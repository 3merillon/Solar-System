//! Synthetic GPU signal tests independent of the scene renderer and its guides.
use crate::{gpu::Gpu, reconstruction::texture, temporal_resolve::TemporalResolve};
fn half(u: u16) -> f32 {
    let sign = if u & 32768 == 0 { 1.0 } else { -1.0 };
    let e = (u >> 10) & 31;
    let m = f32::from(u & 1023) / 1024.0;
    sign * if e == 0 {
        2.0_f32.powi(-14) * m
    } else if e == 31 {
        f32::INFINITY
    } else {
        2.0_f32.powi(i32::from(e) - 15) * (1.0 + m)
    }
}
pub async fn run(g: &Gpu) -> Result<String, String> {
    let mut failures = Vec::new();
    let mut cases = 0;
    let mut max_actual_age = 0.0_f32;
    for output in [16, 32] {
        let hdr = texture(g, "audit HDR", 16, 16, wgpu::TextureFormat::Rgba16Float);
        let display = texture(
            g,
            "audit display",
            output,
            output,
            wgpu::TextureFormat::Rgba8Unorm,
        );
        let mut t = TemporalResolve::new(g, &hdr, &display, None);
        let read = g.buffer(
            "audit history read",
            256 * u64::from(output),
            wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        );
        let size = wgpu::Extent3d {
            width: 16,
            height: 16,
            depth_or_array_layers: 1,
        };
        let mut actual_time = 0.0;
        let mut oldest_time = 0.0;
        // Includes changing frame intervals, a long pause and recovery.
        for (i, dt) in [
            0.016, 0.016, 0.03, 0.1, 0.006, 0.009, 0.081, 0.27, 0.005, 0.01, 0.01, 0.01, 0.01,
            0.01, 0.01, 0.01,
        ]
        .into_iter()
        .enumerate()
        {
            let identity = if i == 9 {
                3u32
            } else if i == 13 {
                5
            } else {
                1
            };
            let depth: f32 = if i == 11 { 100.0 } else { 10.0 };
            let reactive = if i == 12 { 0x3c00u16 } else { 0 };
            let pixel = [0x3c00u16, 0x3800, 0x3400, reactive];
            let pixels = vec![pixel; 256];
            g.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &hdr,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                bytemuck::cast_slice(&pixels),
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(128),
                    rows_per_image: Some(16),
                },
                size,
            );
            let guide = [0, 0, depth.to_bits(), depth.to_bits(), 0, identity];
            let guides = vec![guide; 256];
            g.queue
                .write_buffer(&t.guides[t.index], 0, bytemuck::cast_slice(&guides));
            t.update(
                g,
                [16, 16],
                [
                    1.0,
                    if i == 0 || i == 15 { 1.0 } else { 0.0 },
                    if output == 16 { 1.0 } else { 2.0 },
                    0.0,
                ],
                [0.0; 4],
                [dt, 0.25, 0.001, 0.0],
            );
            let mut e = g.device.create_command_encoder(&Default::default());
            t.encode(&mut e, None);
            t.index = 1 - t.index;
            e.copy_texture_to_buffer(
                wgpu::TexelCopyTextureInfo {
                    texture: t.resolved(),
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::TexelCopyBufferInfo {
                    buffer: &read,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(256),
                        rows_per_image: Some(output),
                    },
                },
                wgpu::Extent3d {
                    width: output,
                    height: output,
                    depth_or_array_layers: 1,
                },
            );
            g.queue.submit([e.finish()]);
            let bytes = g.read(&read).await?;
            actual_time += dt;
            let offset = output as usize / 2 * 256 + output as usize / 2 * 8;
            let rgba: [f32; 4] = std::array::from_fn(|k| {
                half(u16::from_le_bytes(
                    bytes[offset + 2 * k..offset + 2 * k + 2]
                        .try_into()
                        .unwrap(),
                ))
            });
            let count = rgba[3].floor();
            if count <= 1.0 {
                oldest_time = actual_time;
            }
            let actual_age = actual_time - oldest_time;
            max_actual_age = max_actual_age.max(actual_age);
            let reject = matches!(i, 0 | 7 | 10 | 11 | 12 | 13 | 14 | 15);
            let expected_unknown = i == 9 && rgba[3] == 0.0;
            let stable_color = (rgba[0] - 1.0).abs() < 0.002
                && (rgba[1] - 0.5).abs() < 0.002
                && (rgba[2] - 0.25).abs() < 0.002;
            let okay = stable_color
                && actual_age <= 0.25001
                && count <= 15.0
                && (i != 1 || count == 2.0)
                && (!reject || count == 1.0)
                && (i != 9 || expected_unknown);
            if !okay {
                failures.push(serde_json::json!({"output":output,"frame":i,"rgba":rgba,"actual_age":actual_age,"reject":reject}));
            }
            cases += 1;
        }
    }
    let report = serde_json::json!({"cases":cases,"max_oldest_contribution_seconds":max_actual_age,"failures":failures,"passed":failures.is_empty(),"covers":["native and 50% TSR","constant HDR preservation","static accumulation","variable frame intervals","hard oldest-sample age cap","invalid history exclusion and recovery","depth and identity rejection","reactive signal","explicit cut"]});
    if failures.is_empty() {
        Ok(report.to_string())
    } else {
        Err(report.to_string())
    }
}
