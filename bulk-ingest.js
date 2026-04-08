exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-api-key', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }
  const body = JSON.parse(event.body);
  const apiKey = event.headers['x-api-key'];
  const { brand, category, count = 10, existingIds = [], prompt: customPrompt } = body;

  const UNIVERSAL_FIELDS = `
REQUIRED for EVERY robot — fill ALL fields you know, leave unknown as null:
{
  "id": "brand-model-kebab-lowercase",
  "name": "exact product name",
  "brand": "exact manufacturer name",
  "year": 2024,
  "announced": "2024, January CES",
  "released": "2024, Q2",
  "status": "Available|Coming soon|Discontinued|Pre-order",
  "also_known_as": "alternative name or null",
  "regions": ["USA","Europe","Asia"],
  "variants": ["Standard","Pro","EDU"],
  "origin": "Country of manufacture",
  "cat": "Humanoid|Industrial|Service|Consumer|Drones|Educational|Medical|Agricultural|Military",
  "sub": "specific subcategory",
  "tags": ["tag1","tag2","tag3"],
  "fig": "most relevant single emoji",
  "img": "",
  "badge": "HOT|NEW|TOP|",
  "bc": "badge-hot|badge-new|badge-top|",
  "score": 88,
  "rating": 4.6,
  "reviews": 234,
  "price": 29900,
  "price_note": "pricing context e.g. tax excluded, fleet pricing available",
  "desc": "5-6 sentence detailed description with real specs, use cases, customers, key differentiators",
  "highlights": ["key point 1","key point 2","key point 3","key point 4"],
  "also_known_as": null,

  "height_mm": 1820,
  "width_mm": 456,
  "depth_mm": 218,
  "diameter_mm": null,
  "wingspan_mm": null,
  "folded_dimensions": null,
  "weight_kg": 70,
  "weight_without_battery_kg": null,
  "frame_material": "Aircraft-grade aluminium + Titanium alloy",
  "shell_material": "High-strength engineering plastics",
  "surface_finish": "Matte",
  "ip_rating": "IP54",
  "mil_spec": null,
  "operating_temp_min": -10,
  "operating_temp_max": 45,
  "storage_temp": "-20°C to 60°C",
  "humidity": "10-90% non-condensing",
  "shock_resistance": null,
  "colors": ["Matte Black","Arctic White"],
  "custom_branding": false,

  "os": "Ubuntu 22.04",
  "ros": true,
  "ros_version": "ROS2 Humble",
  "chipset": "NVIDIA Jetson AGX Orin",
  "cpu": "Intel Core i7-1260P",
  "cpu_cores": 12,
  "cpu_freq_ghz": 4.7,
  "cpu_arch": "x86-64",
  "cpu_count": 1,
  "compute_standard": null,
  "compute_edu": null,
  "gpu": "NVIDIA RTX 4060",
  "gpu_vram_gb": 8,
  "npu": "NVIDIA Jetson AGX Orin",
  "npu_tops": 275,
  "fpga": null,
  "rtos": "STM32 MCU",
  "control_freq_hz": 1000,

  "ram_gb": 32,
  "ram_type": "LPDDR5",
  "ram_speed_mhz": 6400,
  "ecc_memory": false,
  "storage_gb": 256,
  "storage_type": "NVMe SSD",
  "storage_speed": "3500/3000 MB/s",
  "expandable_storage": true,
  "cloud_storage": "AWS RoboMaker",

  "battery_type": "Li-ion",
  "battery_cells": "14S2P",
  "battery_wh": 972,
  "battery_ah": 15,
  "battery_voltage": "75.6V max",
  "battery_count": 1,
  "battery_life": 180,
  "battery_life_min": 180,
  "battery_life_typical": 150,
  "battery_life_heavy": 90,
  "battery_life_standby": 8,
  "charge_time": 120,
  "charge_time_min": 120,
  "charge_time_fast": null,
  "charge_power_w": 500,
  "charge_type": "Proprietary dock",
  "wireless_charging": false,
  "auto_charge": true,
  "hot_swap": false,
  "quick_release": true,
  "cycle_life": 500,
  "battery_temp_range": "-20°C to 60°C",
  "bms": "Overcharge, over-discharge, temperature, cell balancing",
  "cooling": "Air cooling",
  "power_source": "Battery",

  "ai_model": "UnifoLM",
  "ai_model_type": "VLA",
  "ai_parameters": "7B",
  "ai_open_source": false,
  "ai_cloud_required": false,
  "ai_inference_local": true,
  "learning_methods": ["Imitation learning","Reinforcement learning","Sim-to-real"],
  "sim_platform": "Isaac Sim",
  "training_data_hours": "10,000 hours teleoperation",
  "llm_model": "Proprietary",
  "task_generalisation": "moderate",
  "new_task_learning": true,
  "continual_learning": false,
  "object_classes": null,
  "natural_language_commands": true,
  "ota": true,

  "cameras": "2× stereo RGB + depth",
  "camera_resolution": "12MP per camera",
  "camera_fov": "120°",
  "depth_sensing": "Structured light",
  "lidar": true,
  "lidar_model": "Livox Mid-360",
  "lidar_range_m": 40,
  "lidar_points_per_sec": 200000,
  "imu": true,
  "imu_axes": 9,
  "thermal_camera": false,
  "microphones": "6-mic circular array",
  "speaker_w": 5,
  "touch_sensing": "fingertip pressure",
  "touch_sensors_count": 5,
  "force_sensing": true,
  "cliff_sensors": null,
  "gps": false,
  "rtk": false,

  "wifi": "WiFi 6",
  "wifi_bands": "2.4GHz + 5GHz",
  "bluetooth": "BT 5.2",
  "cellular": null,
  "cellular_sim": null,
  "uwb": false,
  "nfc": false,
  "ethernet": "1GbE",
  "usb_ports": "2× USB-A 3.0, 1× USB-C",
  "industrial_protocols": ["EtherCAT","CAN"],
  "sdk": true,
  "sdk_langs": ["Python","C++","ROS2"],
  "api": true,
  "zigbee_matter": null,

  "ce": true,
  "fcc": true,
  "rohs": true,
  "ul_listed": false,
  "iso_certs": ["ISO 10218-1"],
  "other_certs": [],
  "safety_rating": null,
  "estop": "Hardware button + software",
  "collision_detection": true,
  "sar_head": null,
  "sar_body": null,
  "warranty_months": 12,
  "repairability": null,
  "energy_class": null,
  "support_years": null,
  "made_in": "China",
  "power_consumption_w": null,
  "mtbf_hours": null,
  "design_life_years": null,
  "models": [],
  "wiki": "Wikipedia article title or empty string",
  "website": "https://brand.com/product",
  "datasheet": null,
  "use_cases": ["Research","Manufacturing","Warehouse"],
  "pilot_customers": [],


  "sim_slot": null,
  "esim": null,
  "network_tech": null,
  "network_bands": null,
  "carrier_aggregation": null,

  "display_type": null,
  "display_count": null,
  "display_size_inch": null,
  "display_resolution": null,
  "display_brightness_nits": null,
  "display_refresh_hz": null,
  "display_touch": null,
  "display_protection": null,

  "main_camera_setup": null,
  "main_camera_mp": null,
  "main_camera_aperture": null,
  "main_camera_sensor_size": null,
  "main_camera_ois": null,
  "main_camera_zoom": null,
  "main_camera_fov": null,
  "main_camera_features": [],
  "video_recording": null,

  "speaker_count": null,
  "speaker_placement": null,
  "audio_formats": [],
  "spatial_audio": null,
  "noise_cancellation": null,
  "headphone_jack": null,
  "voice_recognition": null,
  "speech_synthesis": null,
  "languages_spoken": null,

  "sensors_list": [],
  "accelerometer": true,
  "gyroscope": true,
  "compass": true,
  "barometer": null,
  "proximity_sensor": null,
  "color_sensor": null,
  "gas_sensor": null,
  "rain_sensor": null,
  "gesture_control": null,
  "facial_recognition": null,
  "emotion_detection": null,

  "repairability": null,
  "energy_class": null,
  "support_years": null,
  "carbon_footprint": null,
  "recycled_materials_pct": null,
  "perf": {"Mobility": 88, "Dexterity": 86, "Autonomy": 78, "Durability": 90}
}`;

  const catSpecs = {
    "Humanoid": `ALSO ADD these humanoid-specific fields:
dof, leg_dof, arm_dof, waist_dof, head_dof, payload, payload_peak,
arm_torque_nm, leg_torque_nm, forearm_upper_arm_mm, calf_thigh_mm,
arm_reach, arm_length_mm, hand_dof, fingers, opposable_thumb, hand_type,
hand_interchangeable, hand_variants, grasp_force_n, min_object_size_mm,
max_object_diameter_mm, manipulation_level, bimanual, can_use_tools,
touch_sensing, dexterous_hand, dexterous_hand_note, tool_changer,
actuator_type, joint_motor, joint_bearing, locomotion, gait_modes,
speed, run_speed, stair_climbing, max_step_height_mm, fall_recovery,
jump_height_mm, max_incline_deg, height_cm, shoulder_width_mm,
bionic_head, bionic_face, display_face, eye_camera_fov, eye_separation_mm,
quick_release_battery, manual_controller, warranty_edu_months, secondary_dev`,

    "Industrial": `ALSO ADD these industrial-specific fields:
payload, reach, dof, repeatability, speed, axes_config,
base_diameter_mm, footprint_mm, working_envelope_m3, vertical_reach_mm,
hollow_wrist, cable_management, rail_mountable, mobile_base_compatible,
joint_speed_deg_s, joint_torque_nm, joint_ranges_deg, link_lengths_mm,
collaborative, force_torque, safety_rating, iso_certs,
end_effector_type, end_effectors_compatible, quick_change, flange_standard,
gripper_stroke_mm, gripper_force_n, fingertip_options,
ft_sensor_type, ft_force_range_n, ft_torque_range_nm, collision_sensitivity_n, skin_type,
mounting, power_consumption_w, temp_range, cleanroom_class,
programming, controller, teach_pendant, simulation_software,
position_accuracy_mm, cycle_time_s, mtbf_hours, design_life_years,
use_cases, compatible_systems`,

    "Consumer": `ALSO ADD these vacuum/consumer-specific fields:
suction_pa, suction_modes, noise_db, dustbin_ml, water_tank_ml,
mop, mop_type, mop_pressure_g, hot_water_mop, mop_lift_height_mm, detergent_compatible,
auto_empty, auto_empty_capacity_L, auto_refill, self_cleaning,
dock_auto_wash_temp, dock_dry_type, dock_dry_time_min, dock_w, dock_h, dock_depth_mm,
filter, brush_type, side_brushes, carpet_boost, carpet_recognition,
obstacle_avoidance, obstacle_types_recognised, navigation, lidar_type,
mapping, multi_floor_maps, zone_cleaning, virtual_walls, cliff_sensors,
height_mm (how thin), diameter_mm, shape, min_clearance_mm,
wheel_diameter_mm, wheel_drop_mm, max_step_height_mm,
app, voice_control, ai_room_recognition, camera_live_view,
matter_support, local_processing, pet_mode, object_pick_up,
arm (robotic arm - true/false), arm_dof (if arm)`,

    "Drones": `ALSO ADD these drone-specific fields:
frame_type, diagonal_mm, wingspan_mm, motor_count, motor_type, propeller_size_inch,
foldable, folded_dimensions, landing_gear_type, gimbal_mount, payload_mount,
antenna_type, rotor_guards, night_lights,
max_flight_time, hover_time_min, max_speed, max_altitude, max_range,
wind_resistance, noise_db, takeoff_weight, max_takeoff_weight,
camera_mp, sensor_size, camera_zoom, video_res, video_fps,
video_formats, color_profiles, gimbal_axes, gimbal_stabilisation,
thermal, thermal_resolution, lidar, lidar_range_m, multispectral,
gps, rtk, obstacle_sensing, waypoint, autonomous, return_to_home,
transmission, geofencing, faa_remote_id, regulatory_class, ppk_support,
remote_controller, rc_screen, storage_internal_gb, sd_card_max_gb,
operating_temp, use_cases, regulatory_compliance`,

    "Medical": `ALSO ADD these medical-specific fields:
fda_cleared, fda_class, fda_510k, ce_marked, ce_class, mdr_compliant, countries_approved,
surgical_type, robotic_arms, instrument_dof, tremor_filtering, motion_scaling,
haptic_feedback, force_feedback, incision_size_mm, single_port, vision, magnification,
console_type, patient_cart_footprint, setup_time_min,
instrument_cost_usd, instrument_uses, sterilization,
remote_surgery, ar_overlay, fluorescence_imaging, data_recording, ehr_integration,
ai_assist, ai_features, installed_base, annual_procedures, cumulative_procedures,
procedures, training_cases_required, training_required, peer_reviewed_studies,
compatible_instruments, power_requirements`,

    "Agricultural": `ALSO ADD these agricultural-specific fields:
coverage_ha_day, gps_accuracy_cm, working_width_m, row_spacing_cm,
operating_speed, max_slope_pct, night_operation, fleet_size,
operation, computer_vision, plant_recognition,
treatment_type, chemical_free, herbicide_reduction, laser_power_w,
spray_volume_l_ha, tank_capacity_l, seeding_rate, harvest_speed,
yield_increase, labour_reduction, seeding, fertilising, harvesting,
fuel, fuel_consumption, crop_types, climate_zones,
data_output, row_detection, headland_turning, weather_operating, carbon_reduction_pct,
integration`,

    "Service": `ALSO ADD these service-specific fields:
base_type, turning_radius_mm, max_grade_pct, obstacle_height_mm, speed,
navigation, map_building, elevator_capable, multi_floor, door_opening,
outdoor_capable, weather_rating,
display, touchscreen, speech, languages, delivery_bays, bay_capacity,
uv_disinfection, uv_wavelength_nm, uv_coverage_m2_h,
hygiene_mode, face_recognition, emotion_sensing, thermal_imaging,
fleet_management, cloud_platform, api_integration, concurrent_tasks,
daily_trips, customer_deployments, countries_deployed,
arm_reach_mm, use_cases, certifications`,

    "Military": `ALSO ADD these military-specific fields:
role, mil_spec, blast_rating, cbrn_protection,
deploy_method, swim_depth_m, autonomy_level,
encryption, jamming_resistant, export_control,
customers, combat_deployments,
endurance_hours, communication_range_km`,

    "Educational": `ALSO ADD these educational-specific fields:
age_range, grade_level, curriculum, programming_interface,
programming_langs, sensors, actuators, pieces, assembly_time_min,
competition_legal, lesson_library, lms_integration,
expansion_ports, compatible_sets, cloud_platform`
  };

  const systemPrompt = `You are building myrobot.shop — the GSMArena of robots. The world's most comprehensive robot database.

Return a JSON array of ${count} REAL ${brand} robots in the ${category} category.
Use your deep knowledge. Be extremely detailed and accurate with real specs.

${UNIVERSAL_FIELDS}

${catSpecs[category] || ''}

ACCURACY RULES:
- Use REAL specs — real prices, real battery life, real suction power, real payload
- Score 70-99 (flagship=95+, midrange=80-89, budget=70-79)
- Vary specs realistically across models — don't give identical numbers
- Rich descriptions (5-6 sentences) mentioning specific features, customers, differentiators
- Include discontinued models where relevant (status: "Discontinued")
- Exclude these already-added IDs: ${existingIds.slice(0,20).join(', ')}
- Return null for unknown values, NOT empty strings for numbers

Return ONLY the JSON array. Start with [ end with ]. No markdown, no explanation.`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: customPrompt || `Give me ${count} ${brand} robots for the ${category} category. Be comprehensive, accurate and detailed.` }]
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = await response.json();
    const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ text, usage: data.usage })
    };
  } catch (err) {
    return {
      statusCode: err.name === 'AbortError' ? 504 : 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
